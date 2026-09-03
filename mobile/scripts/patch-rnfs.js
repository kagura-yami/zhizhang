const fs = require('fs');
const path = require('path');

// react-native-fs 2.20.0 尚未声明 Android namespace，React Native 0.81
// 的 CLI 在自动链接扫描时会因此失败。安装后补上命名空间即可兼容新版 AGP。
const patches = [
  ['react-native-fs', 'com.rnfs'],
  ['react-native-linear-gradient', 'com.BV.LinearGradient'],
  ['react-native-zip-archive', 'com.rnziparchive'],
  ['react-native-vector-icons', 'com.oblador.vectoricons'],
];
for (const [packageName, namespace] of patches) {
  const gradlePath = path.join(__dirname, '..', 'node_modules', packageName, 'android', 'build.gradle');
  if (!fs.existsSync(gradlePath)) continue;
  const source = fs.readFileSync(gradlePath, 'utf8');
  if (!/namespace\s+["']/.test(source)) {
    fs.writeFileSync(gradlePath, source.replace(/android\s*\{/, `android {\n    namespace "${namespace}"`));
    console.log(`[patch-rnfs] added namespace for ${packageName}`);
  }
}

// react-native-fs 2.20.0 的通用异常分支向 Promise.reject 传入 null 错误码。
// React Native 0.81 的 PromiseImpl.reject 已将 code 视为非空参数，会把一次
// 正常的文件清理失败升级为应用进程崩溃（常见于 unlink 不存在的临时文件）。
// 在 postinstall 中做幂等修补，确保全新安装和 CI 构建也包含这个兜底。
const rnfsSource = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-fs',
  'android',
  'src',
  'main',
  'java',
  'com',
  'rnfs',
  'RNFSManager.java',
);
if (fs.existsSync(rnfsSource)) {
  const source = fs.readFileSync(rnfsSource, 'utf8');
  const broken = 'promise.reject(null, ex.getMessage());';
  const fixed = 'promise.reject("EUNKNOWN", ex.getMessage());';
  if (source.includes(broken)) {
    fs.writeFileSync(rnfsSource, source.replace(broken, fixed));
    console.log('[patch-rnfs] fixed null Promise.reject code');
  }
}
