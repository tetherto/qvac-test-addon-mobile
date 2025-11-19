import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { ASSET_FILES } from '../assetManifest'

/**
 * Load all assets and return a map of project paths to actual URIs
 * @returns {Promise<Object>} Map of project paths to localUri
 */
export async function loadAssetPaths() {
  const assetMap = {}
  
  if (ASSET_FILES.length === 0) {
    console.log('No assets to load')
    return assetMap
  }
  
  console.log(`Loading ${ASSET_FILES.length} asset(s)...`)
  
  // Load each asset individually using Asset.fromModule
  for (const { projectPath, modulePath } of ASSET_FILES) {
    try {
      // Check if this is a JSON file (which gets parsed as an object)
      if (projectPath.endsWith('.json') && typeof modulePath === 'object' && !modulePath.uri) {
        // This is parsed JSON, write it to the filesystem
        const filename = projectPath.split('/').pop()
        const filePath = `${FileSystem.cacheDirectory}${filename}`
        
        await FileSystem.writeAsStringAsync(
          filePath,
          JSON.stringify(modulePath),
          { encoding: FileSystem.EncodingType.UTF8 }
        )
        
        assetMap[projectPath] = filePath
        console.log(`Loaded JSON: ${projectPath} -> ${filePath}`)
      } else {
        // Regular asset (raw, onnx, etc.)
        const asset = Asset.fromModule(modulePath)
        await asset.downloadAsync()
        
        assetMap[projectPath] = asset.localUri.replace('file://', '')
        console.log(`Loaded: ${projectPath} -> ${asset.localUri}`)
      }
    } catch (error) {
      console.error(`Error loading asset ${projectPath}:`, error)
    }
  }
  
  return assetMap
}

