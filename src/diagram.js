// src/diagram.js - v7.7 Bubble Effect

export function renderSystemDiagram(containerId, params) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 🟢 接收 recoveredKW 参数
    const { topology, tSource, tSupply, tDisplaySource, recoveredKW } = params;
    
    const srcTempVal = tDisplaySource !== undefined ? tDisplaySource : tSource;

    const cPipe = "#cbd5e1"; 
    const cHot = "#ef4444";  
    const cCool = "#3b82f6"; 
    const cWaste = "#a855f7"; 
    const cEco = "#10b981";   
    const cGas = "#f59e0b";   
    const cSmoke = "#64748b"; 

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
            <marker id="arrow-eco" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="${cEco}" />
            </marker>
            <marker id="arrow-smoke" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="${cSmoke}" />
            </marker>
        </defs>
        
        <text x="20" y="30" class="text-[10px] font-bold fill-slate-400 font-mono tracking-widest">
            PROCESS FLOW DIAGRAM (PFD) - ${topology === 'RECOVERY' ? 'SCHEME C (DEEP RECOVERY)' : (topology === 'PARALLEL' ? 'SCHEME A' : 'SCHEME B')}
        </text>
    `;

    svg += `
        <rect x="480" y="60" width="80" height="140" rx="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>
        <text x="520" y="130" text-anchor="middle" class="text-sm font-bold fill-slate-600">PLANT</text>
        <text x="520" y="145" text-anchor="middle" class="text-xs fill-slate-400">LOAD</text>
    `;

    if (topology === 'RECOVERY') {
        // === 方案 C: 烟气余热回收 ===
        
        svg += `
            <rect x="50" y="140" width="100" height="60" rx="4" fill="white" stroke="${cGas}" stroke-width="2"/>
            <text x="100" y="170" text-anchor="middle" class="text-xs font-bold fill-slate-700">BOILER</text>
            <text x="100" y="185" text-anchor="middle" class="text-[10px] fill-amber-500">Main Source</text>
        `;

        svg += `
            <path d="M 100 140 L 100 60" stroke="${cSmoke}" stroke-width="6" stroke-linecap="round"/>
            <text x="115" y="70" class="text-[10px] font-bold fill-slate-500">Exhaust</text>
            <text x="115" y="85" class="text-[10px] fill-slate-400">${srcTempVal}°C</text>
        `;

        svg += `
            <rect x="220" y="50" width="120" height="70" rx="4" fill="#ecfdf5" stroke="${cEco}" stroke-width="2"/>
            <text x="280" y="85" text-anchor="middle" class="text-xs font-bold fill-emerald-700">Rec. HP</text>
            <text x="280" y="100" text-anchor="middle" class="text-[10px] fill-emerald-500">Heat Recovery</text>
        `;

        svg += `<path d="M 100 100 L 220 100" stroke="${cSmoke}" stroke-width="2" stroke-dasharray="4" marker-end="url(#arrow-smoke)"/>`;
        
        svg += `<path d="M 280 120 L 280 170 L 200 170" stroke="${cEco}" stroke-width="3" marker-end="url(#arrow-eco)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1s" repeatCount="indefinite" />
                </path>`;
        
        svg += `<path d="M 150 170 L 480 170" stroke="${cHot}" stroke-width="3" marker-end="url(#arrow-hot)"/>`;

        svg += `
            <circle cx="280" cy="170" r="12" fill="white" stroke="${cEco}" stroke-width="2"/>
            <text x="280" y="174" text-anchor="middle" class="text-[10px] font-bold fill-emerald-600">+</text>
        `;

        // --- 🟢 能量增益气泡 (Energy Bubble) ---
        // 只有当计算后传入了 recoveredKW 且大于0时才显示
        if (recoveredKW && recoveredKW > 0) {
            svg += `
                <g transform="translate(280, 30)">
                    <animateTransform attributeName="transform" type="translate" values="280,30; 280,25; 280,30" dur="3s" repeatCount="indefinite" />
                    <rect x="-45" y="-12" width="90" height="24" rx="12" fill="#10b981" stroke="white" stroke-width="2" class="shadow-sm"/>
                    <path d="M -6 12 L 0 18 L 6 12 Z" fill="#10b981"/>
                    <text x="0" y="4" text-anchor="middle" class="text-[11px] font-bold fill-white font-mono drop-shadow-sm">
                        +${Math.round(recoveredKW)} kW
                    </text>
                </g>
            `;
        }

    } else {
        // === 方案 A/B ===
        svg += `
            <g transform="translate(0, 40)">
                <rect x="180" y="140" width="100" height="50" rx="4" fill="white" stroke="${cGas}" stroke-width="2" stroke-dasharray="4"/>
                <text x="230" y="165" text-anchor="middle" class="text-xs font-bold fill-slate-600">BOILER</text>
                <text x="230" y="180" text-anchor="middle" class="text-[10px] fill-amber-500">Baseline</text>
                <path d="M 140 165 L 180 165" stroke="${cGas}" stroke-width="2"/>
                <path d="M 280 165 L 480 165" stroke="${cHot}" stroke-width="2" marker-end="url(#arrow-hot)" stroke-opacity="0.3"/>
            </g>
        `;

        svg += `
            <circle cx="380" cy="130" r="15" fill="white" stroke="#cbd5e1" stroke-width="2"/>
            <text x="380" y="134" text-anchor="middle" class="text-[10px] font-black fill-slate-400">VS</text>
        `;

        if (topology === 'PARALLEL') {
            svg += `
                <circle cx="80" cy="90" r="25" fill="#eff6ff" stroke="${cCool}" stroke-width="1.5" stroke-dasharray="2,2"/>
                <text x="80" y="94" text-anchor="middle" class="text-xs font-bold fill-blue-500">AIR</text>
                <text x="80" y="130" text-anchor="middle" class="text-[10px] fill-slate-400">${srcTempVal}°C</text>
                
                <rect x="180" y="60" width="100" height="60" rx="4" fill="white" stroke="${cCool}" stroke-width="2"/>
                <text x="230" y="90" text-anchor="middle" class="text-xs font-bold fill-slate-700">ASHP</text>
                
                <path d="M 110 90 L 180 90" stroke="${cCool}" stroke-width="2" stroke-dasharray="4"/>
                <path d="M 280 90 L 480 90" stroke="${cHot}" stroke-width="3" marker-end="url(#arrow-hot)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1s" repeatCount="indefinite" />
                </path>
            `;
        } else {
            svg += `
                <circle cx="80" cy="90" r="25" fill="#faf5ff" stroke="${cWaste}" stroke-width="2"/>
                <text x="80" y="85" text-anchor="middle" class="text-[10px] font-bold fill-purple-600">WASTE</text>
                <text x="80" y="130" text-anchor="middle" class="text-[10px] fill-slate-400">${srcTempVal}°C</text>
                
                <rect x="180" y="60" width="100" height="60" rx="4" fill="white" stroke="${cWaste}" stroke-width="2"/>
                <text x="230" y="90" text-anchor="middle" class="text-xs font-bold fill-slate-700">WSHP</text>
                
                <path d="M 110 90 L 180 90" stroke="${cWaste}" stroke-width="3" marker-end="url(#arrow-waste)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1.5s" repeatCount="indefinite" />
                </path>
                <path d="M 280 90 L 480 90" stroke="${cHot}" stroke-width="3" marker-end="url(#arrow-hot)">
                    <animate attributeName="stroke-dasharray" from="0,20" to="20,0" dur="1s" repeatCount="indefinite" />
                </path>
            `;
        }
    }

    const labelY = topology === 'RECOVERY' ? 160 : 75;
    const labelX = topology === 'RECOVERY' ? 400 : 360;
    
    svg += `
        <rect x="${labelX}" y="${labelY}" width="40" height="20" rx="2" fill="white" stroke="#e2e8f0"/>
        <text x="${labelX + 20}" y="${labelY + 14}" text-anchor="middle" class="text-[10px] font-mono fill-slate-600 font-bold">${tSupply}°C</text>
    `;

    svg += `</svg>`;
    container.innerHTML = svg;
}