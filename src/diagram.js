// src/diagram.js - v6.3 Expert Diagram Engine
// 负责绘制 P&ID (管道仪表流程图) 风格的系统拓扑

export function renderSystemDiagram(containerId, params) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { topology, tSource, tSupply } = params;
    
    // 🎨 工业配色系统
    const cPipe = "#cbd5e1"; // 管道基础灰
    const cHot = "#ef4444";  // 供水红
    const cCool = "#3b82f6"; // 冷源蓝
    const cWaste = "#a855f7"; // 余热紫
    const cGas = "#f59e0b";   // 燃料黄
    const cText = "#475569";  // 文本深灰

    // 基础 SVG 容器
    let svg = `
    <svg viewBox="0 0 600 240" class="w-full h-full bg-slate-50 rounded-lg border border-slate-200">
        <defs>
            <marker id="arrow-hot" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="${cHot}" />
            </marker>
            <marker id="arrow-cool" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="${cCool}" />
            </marker>
            <marker id="arrow-waste" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="${cWaste}" />
            </marker>
        </defs>
        
        <text x="20" y="30" class="text-[10px] font-bold fill-slate-400 font-mono tracking-widest">
            PROCESS FLOW DIAGRAM (PFD) - ${topology === 'PARALLEL' ? 'SCHEME A' : 'SCHEME B'}
        </text>
    `;

    // --- 公共组件：右侧用户负荷 & 底部锅炉基准 ---
    
    // 1. 用户负荷 (Common Load)
    svg += `
        <rect x="480" y="60" width="80" height="140" rx="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>
        <text x="520" y="130" text-anchor="middle" class="text-sm font-bold fill-slate-600">PLANT</text>
        <text x="520" y="145" text-anchor="middle" class="text-xs fill-slate-400">LOAD</text>
    `;

    // 2. 底部基准：传统锅炉 (Baseline Boiler)
    // 位置：y=160
    svg += `
        <g transform="translate(0, 40)">
            <rect x="180" y="140" width="100" height="50" rx="4" fill="white" stroke="${cGas}" stroke-width="2" stroke-dasharray="4"/>
            <text x="230" y="165" text-anchor="middle" class="text-xs font-bold fill-slate-600">BOILER</text>
            <text x="230" y="180" text-anchor="middle" class="text-[10px] fill-amber-500">Baseline</text>
            <path d="M 140 165 L 180 165" stroke="${cGas}" stroke-width="2"/>
            <text x="135" y="168" text-anchor="end" class="text-[10px] fill-amber-600">Fuel</text>
            <path d="M 280 165 L 480 165" stroke="${cHot}" stroke-width="2" marker-end="url(#arrow-hot)" stroke-opacity="0.3"/>
        </g>
    `;

    // 3. VS 徽章 (强调方案对比)
    svg += `
        <circle cx="380" cy="130" r="15" fill="white" stroke="#cbd5e1" stroke-width="2"/>
        <text x="380" y="134" text-anchor="middle" class="text-[10px] font-black fill-slate-400">VS</text>
    `;

    // --- 差异化组件：顶部热泵方案 ---

    if (topology === 'PARALLEL') {
        // === 方案 A: 空气源 (Air Source) ===
        
        // 空气源图标 (云朵/风扇意向)
        svg += `
            <circle cx="80" cy="90" r="25" fill="#eff6ff" stroke="${cCool}" stroke-width="1.5" stroke-dasharray="2,2"/>
            <text x="80" y="94" text-anchor="middle" class="text-xs font-bold fill-blue-500">AIR</text>
            <text x="80" y="130" text-anchor="middle" class="text-[10px] fill-slate-400">${tSource}°C</text>
        `;

        // ASHP 机组
        svg += `
            <rect x="180" y="60" width="100" height="60" rx="4" fill="white" stroke="${cCool}" stroke-width="2"/>
            <text x="230" y="90" text-anchor="middle" class="text-xs font-bold fill-slate-700">ASHP</text>
            <text x="230" y="105" text-anchor="middle" class="text-[10px] fill-blue-400">Air Source</text>
        `;

        // 连接管路
        // 空气 -> 热泵 (虚线代表空气流)
        svg += `<path d="M 110 90 L 180 90" stroke="${cCool}" stroke-width="2" stroke-dasharray="4"/>`;
        
        // 热泵 -> 负载
        svg += `<path d="M 280 90 L 480 90" stroke="${cHot}" stroke-width="3" marker-end="url(#arrow-hot)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1s" repeatCount="indefinite" />
                </path>`;

    } else {
        // === 方案 B: 余热源 (Waste Source) ===
        
        // 余热源图标 (管道截面意向)
        svg += `
            <circle cx="80" cy="90" r="25" fill="#faf5ff" stroke="${cWaste}" stroke-width="2"/>
            <path d="M 65 90 L 95 90" stroke="${cWaste}" stroke-width="2"/>
            <text x="80" y="75" text-anchor="middle" class="text-[10px] font-bold fill-purple-600">WASTE</text>
            <text x="80" y="130" text-anchor="middle" class="text-[10px] fill-slate-400">${tSource}°C</text>
        `;

        // WSHP 机组
        svg += `
            <rect x="180" y="60" width="100" height="60" rx="4" fill="white" stroke="${cWaste}" stroke-width="2"/>
            <text x="230" y="90" text-anchor="middle" class="text-xs font-bold fill-slate-700">WSHP</text>
            <text x="230" y="105" text-anchor="middle" class="text-[10px] fill-purple-500">Water Source</text>
        `;

        // 连接管路
        // 余热 -> 热泵
        svg += `<path d="M 110 90 L 180 90" stroke="${cWaste}" stroke-width="3" marker-end="url(#arrow-waste)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1.5s" repeatCount="indefinite" />
                </path>`;
        
        // 热泵 -> 负载
        svg += `<path d="M 280 90 L 480 90" stroke="${cHot}" stroke-width="3" marker-end="url(#arrow-hot)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1s" repeatCount="indefinite" />
                </path>`;
    }

    // 目标温度标签 (Common Label)
    svg += `
        <rect x="360" y="75" width="40" height="20" rx="2" fill="white" stroke="#e2e8f0"/>
        <text x="380" y="89" text-anchor="middle" class="text-[10px] font-mono fill-slate-600 font-bold">${tSupply}°C</text>
    `;

    svg += `</svg>`;
    container.innerHTML = svg;
}