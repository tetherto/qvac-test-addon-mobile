'use strict'

const fs = require('bare-fs')
const path = require('bare-path')

let _diffusionModel = null

async function _downloadFile (url, dest) {
  const https = require('bare-https')
  return new Promise((resolve, reject) => {
    let resolved = false
    const safeResolve = () => { if (!resolved) { resolved = true; resolve() } }
    const safeReject = (err) => { if (!resolved) { resolved = true; reject(err) } }

    const file = fs.createWriteStream(dest)

    file.on('error', (err) => {
      file.destroy()
      fs.unlink(dest, () => safeReject(err))
    })

    const req = https.request(url, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        file.destroy()
        fs.unlink(dest, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== 'ENOENT') return safeReject(unlinkErr)
          const redirectUrl = new URL(response.headers.location, url).href
          _downloadFile(redirectUrl, dest).then(safeResolve).catch(safeReject)
        })
        return
      }

      if (response.statusCode !== 200) {
        file.destroy()
        fs.unlink(dest, () => safeReject(new Error('Download failed: HTTP ' + response.statusCode)))
        return
      }

      response.on('error', (err) => {
        file.destroy()
        fs.unlink(dest, () => safeReject(err))
      })

      response.pipe(file)
      file.on('close', safeResolve)
    })

    req.on('error', (err) => {
      file.destroy()
      fs.unlink(dest, () => safeReject(err))
    })

    req.end()
  })
}

async function _ensureModel (modelName, downloadUrl, modelDir) {
  const modelPath = path.join(modelDir, modelName)
  if (fs.existsSync(modelPath)) {
    console.log('Model already on disk: ' + modelName)
    return
  }
  fs.mkdirSync(modelDir, { recursive: true })
  console.log('Downloading model ' + modelName + ' (this may take several minutes)...')
  await _downloadFile(downloadUrl, modelPath)
  const stats = fs.statSync(modelPath)
  console.log('Model downloaded: ' + (stats.size / 1024 / 1024).toFixed(1) + ' MB')
}

async function handleGenerateImage (req, dirPath) {
  try {
    const data = JSON.parse(req.data.toString('utf8'))
    const { prompt, negativePrompt, steps, width, height, cfgScale, seed } = data

    let ImgStableDiffusion
    try {
      ImgStableDiffusion = require('@qvac/diffusion-cpp')
    } catch (e) {
      try {
        ImgStableDiffusion = require('./index.js')
      } catch (e2) {
        throw new Error('Diffusion addon not available: ' + e.message)
      }
    }

    const modelName = 'stable-diffusion-v2-1-Q8_0.gguf'
    const modelUrl = 'https://huggingface.co/gpustack/stable-diffusion-v2-1-GGUF/resolve/main/stable-diffusion-v2-1-Q8_0.gguf'
    const modelRoot = global.testDir || dirPath
    const modelDir = path.join(modelRoot, 'test', 'model')

    await _ensureModel(modelName, modelUrl, modelDir)

    if (!_diffusionModel) {
      const os = require('bare-os')
      const proc = require('bare-process')
      const platform = os.platform()
      const arch = os.arch()
      const isDarwinX64 = platform === 'darwin' && arch === 'x64'
      const isLinuxArm64 = platform === 'linux' && arch === 'arm64'
      const noGpu = proc.env && proc.env.NO_GPU === 'true'
      const useCpu = isDarwinX64 || isLinuxArm64 || noGpu

      _diffusionModel = new ImgStableDiffusion({
        modelName: modelName,
        diskPath: modelDir,
        logger: console
      }, {
        threads: '4',
        device: 'gpu',
        prediction: 'v',
        diffusion_fa: true,
        flash_attn: true,
        mmap: true,
        diffusion_conv_direct: true,
        vae_conv_direct: true,
        verbosity: '2'
      })

      console.log('Loading diffusion model...')
      await _diffusionModel.load()
      console.log('Diffusion model loaded')
    }

    console.log('Starting image generation...')
    const startTime = Date.now()

    const response = await _diffusionModel.run({
      prompt: prompt || 'a beautiful sunset over mountains',
      negative_prompt: negativePrompt || 'blurry, low quality, watermark, text',
      steps: steps || 5,
      width: width || 512,
      height: height || 512,
      cfg_scale: cfgScale || 7.5,
      seed: seed != null ? seed : -1
    })

    const images = []
    await response
      .onUpdate((chunk) => {
        if (chunk instanceof Uint8Array) {
          images.push(chunk)
        }
      })
      .await()

    const elapsed = Date.now() - startTime
    console.log('Generated ' + images.length + ' image(s) in ' + (elapsed / 1000).toFixed(1) + 's')

    const outputDir = path.join(global.testDir || dirPath, 'generated_images')
    fs.mkdirSync(outputDir, { recursive: true })

    const imagePaths = images.map((img, i) => {
      const filename = 'image_' + Date.now() + '_' + i + '.png'
      const filepath = path.join(outputDir, filename)
      fs.writeFileSync(filepath, img)
      return 'file://' + filepath
    })

    req.reply(JSON.stringify({
      success: true,
      imagePaths: imagePaths,
      count: images.length,
      elapsed: elapsed
    }))
  } catch (error) {
    console.error('Generate image error:', error)
    req.reply(JSON.stringify({
      success: false,
      error: error.message
    }))
  }
}

module.exports = { handleGenerateImage }
