import { useState, useEffect } from 'react'
import { Text, View, StyleSheet, ScrollView } from 'react-native'
import useWorklet from './hooks/useWorklet'
import * as FileSystem from 'expo-file-system/legacy'
import { INIT, RUN_TEST } from '../backend/api.cjs'
import { loadAssetPaths } from './utils/assetLoader'
import { TEST_FUNCTIONS } from './testConfig'
import { playAudio } from './utils/audio'

const dirPath = `${FileSystem.documentDirectory.replace('file://', '')}`

export default function App() {
    const [rpc, rpcReady] = useWorklet({})
    const [messages, setMessages] = useState(['Initializing...'])
    const [assetPaths, setAssetPaths] = useState(null)

    // Load assets on mount
    useEffect(() => {
        loadAssetPaths()
            .then(paths => {
                console.log('Asset paths loaded:', paths)
                setAssetPaths(paths)
            })
            .catch(error => {
                console.error('Failed to load assets:', error)
                addMessage('Failed to load assets')
            })
    }, [])

    useEffect(() => {
        if (rpcReady && assetPaths !== null) {
            setTimeout(() => {
                init()
            }, 3000)
        }
    }, [rpcReady, assetPaths])

    // Helper function to add a message to the list
    function addMessage(msg) {
        setMessages(prev => [...prev, msg])
    }

    async function init() {
        if (!rpc) {
            addMessage('RPC NOT WORKING')
            return
        }
        console.log('INITIALIZING', dirPath)
        console.log('Asset paths:', assetPaths)
        
        const request = rpc.request(INIT)
        // Send asset paths along with dirPath as JSON
        request.send(JSON.stringify({ dirPath, assetPaths }))
        const response = await request.reply('utf8')
        addMessage(response.toString())
        
        // After initialization, run all tests
        setTimeout(() => {
            runAllTests()
        }, 2000)
    }

    async function runAllTests() {
        console.log('Running all tests:', TEST_FUNCTIONS)
        addMessage(`\nRunning ${TEST_FUNCTIONS.length} test(s)...`)
        
        for (const testName of TEST_FUNCTIONS) {
            await runTest(testName)
        }
        
        addMessage('\nAll tests completed!')
    }

    async function runTest(testName) {
        if (!rpc) {
            addMessage(`${testName}: FAIL - RPC not ready`)
            return
        }
        
        try {
            console.log(`Running test: ${testName}`)
            const request = rpc.request(RUN_TEST)
            request.send(JSON.stringify({ testName }))
            const response = await request.reply('utf8')
            const result = JSON.parse(response.toString())
            console.log('Result:', result.result)
            handleResultData(result.result)
            if (result.success) {
                console.log(`✅ ${testName} passed`)
                addMessage(`${testName}: PASS`)
            } else {
                console.error(`❌ ${testName} failed:`, result.error)
                addMessage(`${testName}: FAIL - ${result.error}`)
            }
        } catch (error) {
            console.error(`Error running test ${testName}:`, error)
            addMessage(`${testName}: FAIL - ${error.message}`)
        }
    }

    async function handleResultData(jsonResult) {
        if (jsonResult.audioData) {
            try {
                await playAudio(jsonResult.audioData)
                addMessage('Audio playback completed')
            } catch (error) {
                console.error('Failed to play audio:', error)
                addMessage(`Audio playback failed: ${error.message}`)
            }
        }
        if (jsonResult.fullText) {
            addMessage(`Full Text: ${jsonResult.fullText}`)
        }
        if (jsonResult.score) {
            addMessage(`Score: ${jsonResult.score}`)
        }
    }

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
                <Text style={styles.text} testID="text">
                    {messages.join('\n')}
                </Text>
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'white',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 20,
        paddingTop: 60,
    },
    text: {
        color: 'black',
        fontSize: 14,
        fontFamily: 'monospace',
    },
})