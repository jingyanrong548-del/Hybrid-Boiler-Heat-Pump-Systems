// src/core/api.js
// 根据环境自动选择 API 地址
// 开发环境：使用本地后端 (http://localhost:8000)
// 生产环境：使用 Vercel API 路由（相对路径）

// 判断是否为开发环境：检查是否在 localhost 或 127.0.0.1 运行
const isDevelopment = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || 
     window.location.hostname === '127.0.0.1' ||
     import.meta.env.DEV);

const API_BASE = isDevelopment
    ? "http://localhost:8000"  // 开发环境：本地后端
    : "/api";  // 生产环境：使用 Vercel API 路由（相对路径）

// 后端API调用已禁用，完全使用前端JS计算
// 注释掉控制台输出，避免不必要的日志
// if (isDevelopment) {
//     console.log("🔧 开发模式：使用本地后端", API_BASE);
// } else {
//     console.log("🌐 生产模式：使用 Vercel API", API_BASE);
// }

/**
 * 呼叫 Python 后端执行 Scheme C (逆向平衡)
 * 支持自动回退：如果本地后端不可用，尝试使用相对路径 API
 */
// 后端API调用已禁用，完全使用前端JS计算
// 此函数保留用于向后兼容，但不再实际调用后端
export async function fetchSchemeC(payload) {
    // 不再调用后端，直接抛出错误提示使用JS计算
    throw new Error("后端API调用已禁用，请使用前端JS计算模式");
}