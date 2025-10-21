import { Asset } from 'expo-asset'
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
  
  // Load all assets using Asset.loadAsync
  const modules = ASSET_FILES.map(({ modulePath }) => modulePath)
  const assets = await Asset.loadAsync(modules)
  
  // Map project paths to localUri
  ASSET_FILES.forEach(({ projectPath }, index) => {
    const asset = Array.isArray(assets) ? assets[index] : assets
    assetMap[projectPath] = asset.localUri.replace('file://', '')
    console.log(`Loaded: ${projectPath} -> ${asset.localUri}`)
  })
  
  return assetMap
}

