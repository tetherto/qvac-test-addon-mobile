#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

/**
 * Build Test App Script
 * 
 * This script:
 * 1. Takes an addon path, .tgz file, or published npm package name
 * 2. Reads the test/mobile/test.cjs from the addon
 * 3. Extracts individual test functions (async function declarations)
 * 4. Generates backend.cjs with individual test runners and error handling
 * 5. Generates testConfig.js with list of test functions
 * 6. Generates e2e/tests/app.test.js with WebDriver test cases
 * 7. Installs the addon package and dependencies
 * 8. Bundles the app
 * 
 * Supported input formats:
 * - Local directory: ./path/to/addon
 * - Local .tgz file: ./path/to/addon.tgz
 * - Published package: my-addon or @scope/my-addon
 * - Published package with version: my-addon@1.0.0 or @scope/my-addon@1.0.0
 * 
 * How tests are run:
 * - Each test function is run individually via RUN_TEST RPC command
 * - Tests are isolated with try-catch, so one failure doesn't stop others
 * - Results are accumulated on screen as "testName: PASS" or "testName: FAIL"
 * - WebDriver tests check for these individual results
 */

function log(message) {
  console.log(`[BUILD] ${message}`)
}

function error(message) {
  console.error(`[ERROR] ${message}`)
  process.exit(1)
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    error('Usage: node build-test-app.js <addon-path-or-tgz-or-package>')
  }
  
  const addonSource = args[0]
  
  // Check if it's a local path (directory or .tgz file)
  const isLocalPath = fs.existsSync(addonSource)
  
  // If not a local path, assume it's a published package name
  // Package names can be scoped (@scope/name) or unscoped (name)
  if (!isLocalPath) {
    log(`'${addonSource}' is not a local path, treating as published package name`)
  }
  
  return { addonSource, isLocalPath }
}

/**
 * Check if addon is already installed with the same source
 */
function isAddonAlreadyInstalled(addonSource, isLocalPath, projectRoot) {
  const pkgJsonPath = path.join(projectRoot, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) {
    return false
  }
  
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  
  // Get the package name that will be installed
  let packageName
  if (!isLocalPath) {
    // Extract package name from published package (handle @scope/name@version)
    const nameWithoutVersion = addonSource.split('@').filter(Boolean)
    if (addonSource.startsWith('@')) {
      packageName = `@${nameWithoutVersion[0]}`
    } else {
      packageName = nameWithoutVersion[0]
    }
  } else {
    // For local paths, we need to read the package name from the source
    const stats = fs.statSync(addonSource)
    const isDirectory = stats.isDirectory()
    
    if (isDirectory) {
      const sourcePkgPath = path.join(addonSource, 'package.json')
      const sourcePkg = JSON.parse(fs.readFileSync(sourcePkgPath, 'utf8'))
      packageName = sourcePkg.name
    } else {
      // For .tgz, extract package name
      const output = execSync(`tar -xzOf "${addonSource}" package/package.json`, {
        encoding: 'utf8'
      })
      const pkg = JSON.parse(output)
      packageName = pkg.name
    }
  }
  
  // Check if package exists in dependencies
  const currentSource = pkgJson.dependencies?.[packageName]
  if (!currentSource) {
    return false
  }
  
  // For local paths, check if the source matches
  if (isLocalPath) {
    const resolvedSource = path.resolve(addonSource)
    const stats = fs.statSync(addonSource)
    const isDirectory = stats.isDirectory()
    
    // If current source is a .tgz file
    if (currentSource.endsWith('.tgz')) {
      if (isDirectory) {
        // Check if the .tgz was created from this directory
        // Extract the directory path from the .tgz path
        const tgzDir = path.dirname(currentSource)
        const resolvedTgzDir = path.resolve(projectRoot, tgzDir)
        
        // If the .tgz is in the same directory as our source, consider it installed
        return resolvedSource === resolvedTgzDir
      } else {
        // Both are .tgz files, compare paths
        const resolvedCurrent = path.resolve(projectRoot, currentSource)
        return resolvedSource === resolvedCurrent
      }
    }
    
    // For directories, they should match
    const resolvedCurrent = path.resolve(projectRoot, currentSource)
    return resolvedSource === resolvedCurrent
  }
  
  // For npm packages, if it exists, consider it installed
  // (user can manually update version if needed)
  return true
}

/**
 * Clean up duplicate dependencies in package.json and remove old package entry
 * This ensures a clean state before installing
 */
function cleanupAndRemovePackage(packageName, projectRoot) {
  const pkgJsonPath = path.join(projectRoot, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) {
    return
  }
  
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  
  // Remove the package if it exists
  if (pkgJson.dependencies && pkgJson.dependencies[packageName]) {
    log(`Removing existing ${packageName} entry before reinstalling...`)
    delete pkgJson.dependencies[packageName]
    
    // Write back the cleaned package.json
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8')
  }
}

/**
 * Install addon package and get its installed path
 */
function installAddonPackage(addonSource, isLocalPath, projectRoot) {
  // Get the package name first
  let packageName
  if (!isLocalPath) {
    const nameWithoutVersion = addonSource.split('@').filter(Boolean)
    if (addonSource.startsWith('@')) {
      packageName = `@${nameWithoutVersion[0]}`
    } else {
      packageName = nameWithoutVersion[0]
    }
  } else {
    const stats = fs.statSync(addonSource)
    const isDirectory = stats.isDirectory()
    
    if (isDirectory) {
      const sourcePkgPath = path.join(addonSource, 'package.json')
      const sourcePkg = JSON.parse(fs.readFileSync(sourcePkgPath, 'utf8'))
      packageName = sourcePkg.name
    } else {
      const output = execSync(`tar -xzOf "${addonSource}" package/package.json`, {
        encoding: 'utf8'
      })
      const pkg = JSON.parse(output)
      packageName = pkg.name
    }
  }
  
  // Remove any existing entry to prevent duplicates
  cleanupAndRemovePackage(packageName, projectRoot)
  
  log('Installing addon package...')
  
  if (!isLocalPath) {
    // It's a published package name, install directly from npm
    log(`Installing package from npm: ${addonSource}`)
    execSync(`bun install "${addonSource}"`, {
      cwd: projectRoot,
      stdio: 'inherit'
    })
  } else {
    const stats = fs.statSync(addonSource)
    const isDirectory = stats.isDirectory()
    
    if (isDirectory) {
      // If it's a directory, pack it first
      log('Packing addon directory...')
      const packOutput = execSync('npm pack', {
        cwd: addonSource,
        encoding: 'utf8'
      }).trim()
      
      const tgzPath = path.join(addonSource, packOutput)
      log(`Created package: ${tgzPath}`)
      
      // Install the .tgz file
      execSync(`bun install "${tgzPath}"`, {
        cwd: projectRoot,
        stdio: 'inherit'
      })
      
      // Clean up the .tgz file
      fs.unlinkSync(tgzPath)
    } else {
      // It's a .tgz file, install directly
      execSync(`bun install "${addonSource}"`, {
        cwd: projectRoot,
        stdio: 'inherit'
      })
    }
  }
  
  log('Addon package installed successfully')
}

/**
 * Get package name from installed addon
 */
function getInstalledPackageName(addonSource, isLocalPath) {
  if (!isLocalPath) {
    if (addonSource.startsWith('@')) {
      const atIndex = addonSource.indexOf('@', 1)
      if (atIndex === -1) {
        return addonSource
      }
      return addonSource.substring(0, atIndex)
    } else {
      const atIndex = addonSource.indexOf('@')
      if (atIndex === -1) {
        return addonSource
      }
      return addonSource.substring(0, atIndex)
    }
  }
  
  const stats = fs.statSync(addonSource)
  const isDirectory = stats.isDirectory()
  
  if (isDirectory) {
    // Read package.json from source directory
    const pkgPath = path.join(addonSource, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.name
  } else {
    // For .tgz, we need to extract package name from tarball
    // Use npm pack --json to get info without extracting
    const tgzDir = path.dirname(addonSource)
    const tgzFile = path.basename(addonSource)
    
    // Read the tarball's package.json
    const output = execSync(`tar -xzOf "${addonSource}" package/package.json`, {
      encoding: 'utf8'
    })
    const pkg = JSON.parse(output)
    return pkg.name
  }
}

/**
 * Read test code from installed addon in node_modules
 */
function readTestCode(packageName, projectRoot) {
  const addonPath = path.join(projectRoot, 'node_modules', packageName)
  const testFilePath = path.join(addonPath, 'test', 'mobile', 'test.cjs')
  
  if (!fs.existsSync(testFilePath)) {
    error(`Test file not found: ${testFilePath}\nMake sure the addon has test/mobile/test.cjs`)
  }
  
  log(`Reading test code from: ${testFilePath}`)
  return fs.readFileSync(testFilePath, 'utf8')
}

/**
 * Read package.json from installed addon
 */
function readAddonPackageJson(packageName, projectRoot) {
  const addonPath = path.join(projectRoot, 'node_modules', packageName)
  const pkgPath = path.join(addonPath, 'package.json')
  
  if (!fs.existsSync(pkgPath)) {
    error(`Package.json not found: ${pkgPath}`)
  }
  
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
}

/**
 * Extract the core test logic (everything except module.exports)
 */
function extractTestLogic(testCode) {
  // Remove the module.exports line and everything after it
  const lines = testCode.split('\n')
  const filteredLines = []
  
  for (const line of lines) {
    // Stop when we hit module.exports - don't include anything after this
    if (line.includes('module.exports')) {
      break
    }
    filteredLines.push(line)
  }
  
  // Remove trailing empty lines
  while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() === '') {
    filteredLines.pop()
  }
  
  return filteredLines.join('\n')
}

/**
 * Extract individual test function names and their parameters from test code
 * Looks for async function declarations like: async function testFoo() {...}
 * Returns array of objects: [{ name: 'testFoo', hasDirPathParam: true, hasGetAssetPathParam: true }]
 */
function extractTestFunctions(testCode) {
  const functionRegex = /async\s+function\s+(\w+)\s*\(([^)]*)\)/g
  const functions = []
  let match
  
  while ((match = functionRegex.exec(testCode)) !== null) {
    const functionName = match[1]
    const params = match[2].trim()
    
    // Exclude init and helper functions (starting with _)
    if (functionName !== 'init' && !functionName.startsWith('_')) {
      // Check if function has dirPath and getAssetPath parameters
      const hasDirPathParam = params.includes('dirPath')
      const hasGetAssetPathParam = params.includes('getAssetPath')
      functions.push({ 
        name: functionName, 
        hasDirPathParam,
        hasGetAssetPathParam
      })
    }
  }
  
  log(`Found ${functions.length} test function(s): ${functions.map(f => f.name).join(', ')}`)
  return functions
}

/**
 * Generate backend.cjs with injected test logic
 */
function generateBackend(testLogic, testFunctions) {
  return `const { INIT, RUN_TEST } = require('./api.cjs')
const RPC = require('bare-rpc')

// ============================================
// STATIC INIT FUNCTIONALITY
// ============================================
// Global dirPath variable used by test functions
let dirPath = null

/**
 * Initialize the test environment
 * @param {string} path - The directory path for test assets
 * @param {Object} assets - Map of asset project paths to actual URIs
 * @returns {Promise<string>}
 */
async function init(path, assets = {}) {
  try {
    dirPath = path
    global.assetPaths = assets
    console.log(\`Initialized with dirPath: \${dirPath}\`)
    console.log(\`Asset paths:\`, Object.keys(global.assetPaths))
    return 'INITIALIZED'
  } catch (error) {
    console.error('Error during initialization:', error)
    throw new Error(\`Init failed: \${error.message}\`)
  }
}

function getAssetPath(assetName) {
  const projectPath = \`../../testAssets/\${assetName}\`
  if (global.assetPaths && global.assetPaths[projectPath]) {
    // Remove file:// prefix if present and return the actual path
    return global.assetPaths[projectPath].replace('file://', '')
  }
  // Fallback to require.asset if not found in map
  return require.asset(\`../testAssets/\${assetName}\`, __filename)
}

// ============================================
// END STATIC INIT FUNCTIONALITY
// ============================================

// ============================================
// INJECTED TEST CODE FROM ADDON
// ============================================
${testLogic}
// ============================================
// END INJECTED TEST CODE
// ============================================

// Map of test functions
const testFunctionMap = {
${testFunctions.map(fn => {
  // Build the parameter list based on what the function needs
  const params = []
  if (fn.hasDirPathParam) {
    params.push('dirPath')
  }
  if (fn.hasGetAssetPathParam) {
    params.push('getAssetPath')
  }
  
  // If function has parameters, wrap it to pass them
  if (params.length > 0) {
    return `  '${fn.name}': () => ${fn.name}(${params.join(', ')})`
  } else {
    return `  '${fn.name}': ${fn.name}`
  }
}).join(',\n')}
}

// RPC request handlers
async function handleInit(req) {
    try {
        const data = JSON.parse(req.data.toString('utf8'))
        const { dirPath: path, assetPaths } = data
        const result = await init(path, assetPaths || {})
        req.reply(result)
    } catch (error) {
        console.error('Init error:', error)
        req.reply(\`Error: \${error.message}\`)
    }
}

async function handleRunTest(req) {
    try {
        const data = JSON.parse(req.data.toString('utf8'))
        const { testName } = data
        
        if (!testFunctionMap[testName]) {
            req.reply(JSON.stringify({ 
                success: false, 
                error: \`Test function '\${testName}' not found\` 
            }))
            return
        }
        
        console.log(\`Running test: \${testName}\`)
        
        try {
            const result = await testFunctionMap[testName]()
            console.log(\`Test '\${testName}' passed\`)
            req.reply(JSON.stringify({ 
                success: true, 
                testName,
                result 
            }))
        } catch (error) {
            console.error(\`Test '\${testName}' failed:\`, error)
            req.reply(JSON.stringify({ 
                success: false, 
                testName,
                error: error.message,
                stack: error.stack
            }))
        }
    } catch (error) {
        console.error('Run test error:', error)
        req.reply(JSON.stringify({ 
            success: false, 
            error: \`Failed to parse request: \${error.message}\` 
        }))
    }
}

// Initialize RPC server
const rpc = new RPC(BareKit.IPC, (req) => {
    switch (req.command) {
        case INIT:
            handleInit(req)
            break;
        case RUN_TEST:
            handleRunTest(req)
            break;
        default:
            req.reply(\`Unknown command: \${req.command}\`)
    }
})
`
}

/**
 * Extract dependencies from test code
 */
function extractTestDependencies(testCode) {
  const requireRegex = /require\(['"](@[^/]+\/[^'"]+|[^'"@]+)['"]\)/g
  const dependencies = new Set()
  let match
  
  while ((match = requireRegex.exec(testCode)) !== null) {
    const dep = match[1]
    // Skip bare built-ins and relative imports
    if (!dep.startsWith('.') && !dep.startsWith('bare-')) {
      dependencies.add(dep)
    }
  }
  
  return Array.from(dependencies)
}

/**
 * Install test dependencies
 */
function installTestDependencies(addonPackageJson, testDependencies, projectRoot) {
  const depsToInstall = []
  
  // Check devDependencies for required test deps
  if (addonPackageJson.devDependencies) {
    for (const dep of testDependencies) {
      if (addonPackageJson.devDependencies[dep]) {
        depsToInstall.push(`${dep}@${addonPackageJson.devDependencies[dep]}`)
      }
    }
  }
  
  // Check dependencies for required test deps
  if (addonPackageJson.dependencies) {
    for (const dep of testDependencies) {
      if (addonPackageJson.dependencies[dep]) {
        depsToInstall.push(`${dep}@${addonPackageJson.dependencies[dep]}`)
      }
    }
  }
  
  if (depsToInstall.length > 0) {
    log(`Installing test dependencies: ${depsToInstall.join(', ')}`)
    execSync(`bun install ${depsToInstall.join(' ')}`, {
      cwd: projectRoot,
      stdio: 'inherit'
    })
  } else {
    log('No additional test dependencies needed')
  }
}

/**
 * Copy test assets if they exist
 */
function copyTestAssets(packageName, projectRoot) {
  const addonPath = path.join(projectRoot, 'node_modules', packageName)
  const testAssetsSource = path.join(addonPath, 'test', 'mobile', 'testAssets')
  const testAssetsTarget = path.join(projectRoot, 'testAssets')
  
  if (!fs.existsSync(testAssetsSource)) {
    log('No testAssets folder found in addon, skipping...')
    return false
  }
  
  log('Copying test assets...')
  
  // Create target directory
  if (fs.existsSync(testAssetsTarget)) {
    fs.rmSync(testAssetsTarget, { recursive: true })
  }
  fs.mkdirSync(testAssetsTarget, { recursive: true })
  
  // Copy files recursively
  function copyRecursive(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true })
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true })
        copyRecursive(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }
  
  copyRecursive(testAssetsSource, testAssetsTarget)
  log('Test assets copied successfully')
  return true
}

/**
 * Scan directory recursively and return all file paths
 * Excludes .gitignore and hidden files
 */
function scanDirectory(dir, baseDir = dir) {
  const files = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const entry of entries) {
    // Skip .gitignore and hidden files
    if (entry.name.startsWith('.')) {
      continue
    }
    
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(baseDir, fullPath)
    
    if (entry.isDirectory()) {
      files.push(...scanDirectory(fullPath, baseDir))
    } else {
      files.push(relativePath)
    }
  }
  
  return files
}

/**
 * Generate asset manifest from testAssets directory
 */
function generateAssetManifest(projectRoot) {
  const testAssetsDir = path.join(projectRoot, 'testAssets')
  const outputFile = path.join(projectRoot, 'app', 'assetManifest.js')
  
  // Check if testAssets exists
  if (!fs.existsSync(testAssetsDir)) {
    log('No testAssets directory found, creating empty manifest')
    const emptyManifest = `// Auto-generated asset manifest
export const ASSET_FILES = []
`
    fs.writeFileSync(outputFile, emptyManifest, 'utf8')
    return
  }
  
  // Scan for all files
  const files = scanDirectory(testAssetsDir)
  
  log(`Found ${files.length} asset file(s):`)
  files.forEach(f => log(`  - ${f}`))
  
  // Generate the manifest file
  const manifestContent = `// Auto-generated asset manifest
// This file is generated by scripts/build-test-app.js
// Do not edit manually!

export const ASSET_FILES = [
${files.map(f => `  {
    projectPath: '../../testAssets/${f.replace(/\\/g, '/')}',
    modulePath: require('../testAssets/${f.replace(/\\/g, '/')}')
  }`).join(',\n')}
]
`
  
  fs.writeFileSync(outputFile, manifestContent, 'utf8')
  log(`Generated asset manifest at: ${outputFile}`)
}

/**
 * Generate testConfig.js with list of test functions
 */
function generateTestConfig(testFunctions, projectRoot) {
  const configPath = path.join(projectRoot, 'app', 'testConfig.js')
  
  // Extract just the function names for the config
  const testFunctionNames = testFunctions.map(fn => fn.name)
  
  const configContent = `// Auto-generated test configuration
// This file is generated by scripts/build-test-app.js
// Do not edit manually!

export const TEST_FUNCTIONS = ${JSON.stringify(testFunctionNames, null, 2)}
`
  
  fs.writeFileSync(configPath, configContent, 'utf8')
  log(`Generated test config at: ${configPath}`)
}

/**
 * Generate app.test.js with individual test cases
 */
function generateTestFile(testFunctions, projectRoot) {
  const testFilePath = path.join(projectRoot, 'e2e', 'tests', 'app.test.js')
  
  // Extract just the function names for test generation
  const testFunctionNames = testFunctions.map(fn => fn.name)
  
  const testContent = `const { expect, driver } = require("@wdio/globals");

describe('Runner', () => {
    //START TEST
    it('initialize app', async () => {
        const text = await getElementByText('INITIALIZED')

        await text.waitUntil(async () => {
            return await text.isDisplayed()
        }, {
            timeout: 10000,
            interval: 1000
        })

        expect(await text.isDisplayed()).toBe(true)
    })

    //GENERATED TESTS
${testFunctionNames.map(testName => `
    it('${testName}', async () => {
        // Wait for test result to appear
        const passText = await getElementByText('${testName}: PASS')
        const failText = await getElementByText('${testName}: FAIL')
        
        // Wait for either pass or fail with a generous timeout
        await driver.waitUntil(async () => {
            const passDisplayed = await passText.isDisplayed().catch(() => false)
            const failDisplayed = await failText.isDisplayed().catch(() => false)
            return passDisplayed || failDisplayed
        }, {
            timeout: 30000,
            interval: 500,
            timeoutMsg: 'Test ${testName} did not complete within 30 seconds'
        })
        
        // Check which one is displayed
        const passDisplayed = await passText.isDisplayed().catch(() => false)
        const failDisplayed = await failText.isDisplayed().catch(() => false)
        
        // Test should pass (not fail)
        expect(passDisplayed).toBe(true)
        expect(failDisplayed).toBe(false)
    })`).join('\n')}
    //END GENERATED TESTS
})


async function getElementByText(text) {
    if (driver.isAndroid) {
        return await driver.$(\`android=new UiSelector().textContains("\${text}")\`);
    }
    return await driver.$(\`-ios predicate string:label CONTAINS "\${text}"\`);
}
`
  
  fs.writeFileSync(testFilePath, testContent, 'utf8')
  log(`Generated test file at: ${testFilePath}`)
}

/**
 * Bundle the app using bare-pack
 */
function bundleApp(projectRoot) {
  log('Bundling app...')
  
  execSync('npm run bundle', {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  
  log('App bundled successfully')
}

/**
 * Main execution
 */
function main() {
  log('Starting build process...')
  
  const { addonSource, isLocalPath } = parseArgs()
  const projectRoot = path.resolve(__dirname, '..')
  
  // Only resolve to absolute path if it's a local path
  const addonSourcePath = isLocalPath ? path.resolve(addonSource) : addonSource
  
  log(`Addon source: ${addonSourcePath}`)
  log(`Project root: ${projectRoot}`)
  
  // Step 1: Install the addon package (whether directory, .tgz, or npm package)
  installAddonPackage(addonSourcePath, isLocalPath, projectRoot)
  
  // Step 2: Get the installed package name
  const packageName = getInstalledPackageName(addonSourcePath, isLocalPath)
  log(`Package name: ${packageName}`)
  
  // Step 3: Read test code from node_modules
  const testCode = readTestCode(packageName, projectRoot)
  
  // Step 4: Extract test logic
  const testLogic = extractTestLogic(testCode)
  
  // Step 5: Extract test function names
  const testFunctions = extractTestFunctions(testCode)
  
  // Step 6: Extract test dependencies
  const testDependencies = extractTestDependencies(testCode)
  log(`Test dependencies found: ${testDependencies.join(', ')}`)
  
  // Step 7: Read addon's package.json
  const addonPackageJson = readAddonPackageJson(packageName, projectRoot)
  
  // Step 8: Install test dependencies
  installTestDependencies(addonPackageJson, testDependencies, projectRoot)
  
  // Step 9: Generate backend.cjs
  const backendCode = generateBackend(testLogic, testFunctions)
  const backendPath = path.join(projectRoot, 'backend', 'backend.cjs')
  fs.writeFileSync(backendPath, backendCode, 'utf8')
  log(`Generated backend.cjs at: ${backendPath}`)
  
  // Step 10: Copy test assets
  copyTestAssets(packageName, projectRoot)
  
  // Step 11: Generate asset manifest
  log('Generating asset manifest...')
  generateAssetManifest(projectRoot)
  
  // Step 12: Generate test config
  log('Generating test config...')
  generateTestConfig(testFunctions, projectRoot)
  
  // Step 13: Generate test file
  log('Generating test file...')
  generateTestFile(testFunctions, projectRoot)
  
  // Step 14: Bundle app
  bundleApp(projectRoot)
  
  log('✅ Build complete! You can now run the app with:')
  log('   npm run android')
  log('   npm run ios')
}

// Run the script
main()

