// src/diagram.js
// 动态 P&ID (管道仪表流程图) 生成引擎

export function renderSystemDiagram(containerId, params) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { topology, tSource, tSupply, hpState } = params;
    
    // 颜色定义
    const cPipe = "#94a3b8"; // 管道灰
    const cHot = "#ef4444";  // 热水红
    const cWarm = "#f59e0b"; // 温水橙
    const cCool = "#3b82f6"; // 冷水蓝
    const cWaste = "#a855f7"; // 余热紫

    // 基础 SVG 容器
    let svg = `
    <svg viewBox="0 0 600 240" class="w-full h-full bg-slate-50 rounded-lg border border-slate-200">
        <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill="${cPipe}" />
            </marker>
        </defs>
        
        <text x="20" y="30" class="text-xs font-bold fill-slate-400 font-mono">LIVE P&ID VIEW</text>
    `;

    if (topology === 'PARALLEL') {
        // --- 方案 A: 传统并联解耦 ---
        // 1. 空气源热泵模块
        svg += `
            <rect x="50" y="80" width="100" height="80" rx="4" fill="white" stroke="${cCool}" stroke-width="2"/>
            <text x="100" y="115" text-anchor="middle" class="text-xs font-bold fill-slate-700">ASHP</text>
            <text x="100" y="135" text-anchor="middle" class="text-[10px] fill-slate-400">Air Source</text>
            <path d="M 20 100 L 50 100" stroke="${cCool}" stroke-width="2" stroke-dasharray="4"/>
            <text x="35" y="95" text-anchor="middle" class="text-[10px] fill-slate-500">${tSource}°C</text>
        `;

        // 2. 锅炉模块
        svg += `
            <rect x="50" y="180" width="100" height="40" rx="4" fill="white" stroke="${cHot}" stroke-width="2"/>
            <text x="100" y="205" text-anchor="middle" class="text-xs font-bold fill-slate-700">BOILER</text>
        `;

        // 3. 用户侧 (User)
        svg += `
            <rect x="450" y="100" width="80" height="100" rx="4" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="2"/>
            <text x="490" y="155" text-anchor="middle" class="text-sm font-bold fill-slate-600">LOAD</text>
        `;

        // 4. 管道连接 (并联)
        // 热泵 -> 用户
        svg += `<path d="M 150 120 L 450 120" stroke="${cWarm}" stroke-width="3" marker-end="url(#arrow)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1s" repeatCount="indefinite" />
                </path>`;
        // 锅炉 -> 用户
        svg += `<path d="M 150 200 L 250 200 L 250 180 L 450 180" stroke="${cHot}" stroke-width="3" fill="none" marker-end="url(#arrow)"/>`;
        
        // 温度标示
        svg += `<rect x="280" y="105" width="40" height="20" rx="2" fill="white" stroke="#e2e8f0"/>
                <text x="300" y="119" text-anchor="middle" class="text-[10px] font-mono fill-slate-600">${tSupply}°C</text>`;

    } else {
        // --- 方案 B: 余热耦合串联 ---
        // 1. 余热源
        svg += `
            <circle cx="60" cy="120" r="30" fill="white" stroke="${cWaste}" stroke-width="2" stroke-dasharray="4,2"/>
            <text x="60" y="125" text-anchor="middle" class="text-xs font-bold fill-purple-600">Waste</text>
            <text x="60" y="165" text-anchor="middle" class="text-[10px] fill-purple-400">Src: ${tSource}°C</text>
        `;

        // 2. 水源热泵
        svg += `
            <rect x="200" y="80" width="120" height="80" rx="4" fill="white" stroke="${cWaste}" stroke-width="2"/>
            <text x="260" y="115" text-anchor="middle" class="text-xs font-bold fill-slate-700">WSHP</text>
            <text x="260" y="135" text-anchor="middle" class="text-[10px] fill-slate-400">Heat Upgrade</text>
        `;

        // 3. 管道 (源 -> 热泵)
        svg += `<path d="M 90 120 L 200 120" stroke="${cWaste}" stroke-width="3" marker-end="url(#arrow)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1.5s" repeatCount="indefinite" />
                </path>`;

        // 4. 管道 (热泵 -> 用户)
        svg += `<path d="M 320 120 L 450 120" stroke="${cHot}" stroke-width="3" marker-end="url(#arrow)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="0.8s" repeatCount="indefinite" />
                </path>`;

        // 5. 用户
        svg += `
            <rect x="450" y="80" width="80" height="80" rx="4" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="2"/>
            <text x="490" y="125" text-anchor="middle" class="text-sm font-bold fill-slate-600">LOAD</text>
        `;
        
        // 6. 提温标识
        svg += `<text x="385" y="110" text-anchor="middle" class="text-[10px] font-bold fill-red-500">▲ Lift</text>
                <rect x="365" y="130" width="40" height="20" rx="2" fill="white" stroke="#e2e8f0"/>
                <text x="385" y="144" text-anchor="middle" class="text-[10px] font-mono fill-slate-600">${tSupply}°C</text>`;
    }

    svg += `</svg>`;
    container.innerHTML = svg;
}