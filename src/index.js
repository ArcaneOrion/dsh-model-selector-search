export const name = 'model-selector-search'
export const inject = []
export function apply(ctx) {
  // client-only 插件：host 半为无操作占位——profile bundle 要求 manifest 有宿主条目
  // （dsh.bundle.patch insert），否则 boot 直接拒绝加载。全部功能在浏览器半
  // src/client.js（ModuleLoader 静态 bundle，经 exports['./client'] 自动扫描挂载）。
}
