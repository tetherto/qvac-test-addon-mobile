const { withAndroidManifest, withPlugins, withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Plugin to add OpenCL native library support to Android build
 */
const withOpenCLConfig = (config) => {
  return withPlugins(config, [
    withOpenCLAndroidManifest,
    withOpenCLBuildGradle,
  ]);
};

/**
 * Modify AndroidManifest.xml to include OpenCL native library
 */
const withOpenCLAndroidManifest = (config) => {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    
    // Find the application element
    const application = androidManifest.manifest.application?.[0];
    
    if (application) {
      // Check if uses-native-library already exists
      const existingNativeLib = application['uses-native-library']?.find(
        lib => lib.$?.['android:name'] === 'libOpenCL.so'
      );
      
      if (!existingNativeLib) {
        // Add uses-native-library if it doesn't exist
        if (!application['uses-native-library']) {
          application['uses-native-library'] = [];
        }
        
        application['uses-native-library'].push({
          $: {
            'android:name': 'libOpenCL.so'
          }
        });
      }
    }
    
    return config;
  });
};

/**
 * Modify build.gradle to exclude OpenCL library from packaging
 */
const withOpenCLBuildGradle = (config) => {
  return withAppBuildGradle(config, (config) => {
    const buildGradleContent = config.modResults.contents;
    
    // Check if the exclusion already exists
    if (!buildGradleContent.includes('excludes += "/lib/**/libOpenCL.so"')) {
      // Find the packagingOptions jniLibs block and add the exclusion
      const jniLibsRegex = /(jniLibs\s*{\s*useLegacyPackaging[^}]*)/;
      
      if (jniLibsRegex.test(buildGradleContent)) {
        config.modResults.contents = buildGradleContent.replace(
          jniLibsRegex,
          (match) => {
            return match + '\n            excludes += "/lib/**/libOpenCL.so"';
          }
        );
      } else {
        // If packagingOptions doesn't exist, find android block and add it
        const androidBlockRegex = /(android\s*{[\s\S]*?)(}\s*dependencies)/;
        if (androidBlockRegex.test(buildGradleContent)) {
          config.modResults.contents = buildGradleContent.replace(
            androidBlockRegex,
            (match, before, after) => {
              const packagingConfig = `    packagingOptions {
        jniLibs {
            useLegacyPackaging (findProperty('expo.useLegacyPackaging')?.toBoolean() ?: false)
            excludes += "/lib/**/libOpenCL.so"
        }
    }
`;
              return before + packagingConfig + after;
            }
          );
        }
      }
    }
    
    return config;
  });
};

module.exports = withOpenCLConfig; 