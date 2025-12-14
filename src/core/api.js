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

// 在控制台输出当前使用的 API 地址（方便调试）
if (isDevelopment) {
    console.log("🔧 开发模式：使用本地后端", API_BASE);
} else {
    console.log("🌐 生产模式：使用 Vercel API", API_BASE);
}

/**
 * 呼叫 Python 后端执行 Scheme C (逆向平衡)
 * 支持自动回退：如果本地后端不可用，尝试使用相对路径 API
 */
export async function fetchSchemeC(payload) {
    const primaryUrl = `${API_BASE}/calculate/scheme-c`;
    const fallbackUrl = `/api/calculate/scheme-c`;
    
    // 尝试主 API（开发环境：localhost:8000，生产环境：/api）
    try {
        console.log("📡 正在呼叫 Python 后端...", payload);
        console.log("📍 API 地址:", primaryUrl);
        
        const response = await fetch(primaryUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            // 添加超时控制（10秒）
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server Error: ${errText}`);
        }

        const data = await response.json();
        console.log("📥 后端返回数据:", data);
        return data;
    } catch (error) {
        // 🔧 自动回退机制：如果是开发环境且本地后端不可用，尝试使用相对路径
        if (isDevelopment && API_BASE === "http://localhost:8000" && 
            (error.name === 'AbortError' || 
             error.message.includes('Failed to fetch') || 
             error.message.includes('Load failed') ||
             error.message.includes('network') ||
             error.message.includes('CORS'))) {
            
            console.warn("⚠️ 本地后端不可用，尝试使用相对路径 API...");
            console.log("📍 回退 API 地址:", fallbackUrl);
            
            try {
                const fallbackResponse = await fetch(fallbackUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(10000)
                });

                if (!fallbackResponse.ok) {
                    const errText = await fallbackResponse.text();
                    throw new Error(`Server Error: ${errText}`);
                }

                const data = await fallbackResponse.json();
                console.log("✅ 回退 API 成功，返回数据:", data);
                return data;
            } catch (fallbackError) {
                // 回退也失败，提供详细错误信息
                const friendlyError = new Error(
                    `无法连接到后端服务器。\n\n` +
                    `尝试的连接：\n` +
                    `1. ${primaryUrl} - 失败\n` +
                    `2. ${fallbackUrl} - 失败\n\n` +
                    `请确保：\n` +
                    `- 本地后端正在运行: cd ies_backend && python main.py\n` +
                    `- 或者使用已部署的生产环境版本`
                );
                friendlyError.name = 'ConnectionError';
                console.error("❌ API 通信失败（所有尝试均失败）:", friendlyError);
                throw friendlyError;
            }
        }
        
        // 非开发环境或其他错误，直接抛出
        console.error("❌ API 通信失败:", error);
        throw error;
    }
}