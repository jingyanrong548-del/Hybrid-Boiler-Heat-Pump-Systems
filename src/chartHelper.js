// src/chartHelper.js - v7.8 Limit Sync

import Chart from 'chart.js/auto';
import { calculateProcessCycle } from './logic.js';

let chartInstance = null;

export function updateChart(topology, targetMode, tSource, tCurrentTarget, perfectionDegree, recoveryType) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";
    
    // 🟢 确保完善度有默认值
    const eta = perfectionDegree || 0.45;
    const etaDisplay = eta.toFixed(2);

    if (topology === 'RECOVERY') {
        xLabel = "初始排烟温度 (Exhaust In, °C)";
        
        const techName = recoveryType === 'ABSORPTION_HP' ? '吸收式 (Absorption)' : '电动式 (MVR)';
        chartTitle = `余热回收性能: ${techName} (供水 ${tCurrentTarget}°C, η=${etaDisplay})`;

        for (let tIn = 60; tIn <= 180; tIn += 10) {
            labels.push(tIn);
            
            if (recoveryType === 'ABSORPTION_HP') {
                dataCOP.push(1.7); 
            } else {
                const tOutFixed = 40; 
                const tEvap = tOutFixed + 8.0; // 锚定在 48°C
                const tCond = tCurrentTarget + 5;
                
                if (tEvap >= tCond - 2) { // 稍微放宽一点直供判定
                    dataCOP.push(null);
                } else {
                    const tk_evap = tEvap + 273.15;
                    const tk_cond = tCond + 273.15;
                    let cop_carnot = tk_cond / (tk_cond - tk_evap);
                    
                    // 🔴 修复点：将上限从 12 统一为 15，与 logic.js 保持一致
                    if (cop_carnot > 15) cop_carnot = 15;
                    
                    let real_cop = cop_carnot * eta;
                    if (real_cop < 1) real_cop = 1;
                    dataCOP.push(parseFloat(real_cop.toFixed(2)));
                }
            }
        }

    } else if (targetMode === 'STEAM') {
        xLabel = "饱和蒸汽压力 (MPa,a)";
        chartTitle = `蒸汽工况 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        for (let p = 0.1; p <= 1.2; p += 0.1) {
            let val = parseFloat(p.toFixed(1));
            labels.push(val);
            const res = calculateProcessCycle({ 
                mode: 'STEAM', sourceTemp: tSource, targetVal: val, perfectionDegree: eta 
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } else if (topology === 'COUPLED') {
        xLabel = "目标供水温度 (°C)";
        chartTitle = `余热提温 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        for (let t = 45; t <= 95; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', sourceTemp: tSource, targetVal: t, perfectionDegree: eta 
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } else {
        xLabel = "室外环境温度 (°C)";
        chartTitle = `环境温变 COP 趋势 (供水 ${tCurrentTarget}°C, η=${etaDisplay})`;
        for (let t = -40; t <= 40; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', sourceTemp: t, targetVal: tCurrentTarget, perfectionDegree: eta
            });
            dataCOP.push(res.error ? null : res.cop);
        }
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'COP',
                data: dataCOP,
                borderColor: (recoveryType === 'ABSORPTION_HP') ? '#f59e0b' : 
                             (topology === 'RECOVERY' ? '#10b981' : (targetMode === 'STEAM' ? 'rgb(236, 72, 153)' : 'rgb(79, 70, 229)')), 
                backgroundColor: 'rgba(255, 255, 255, 0.0)',
                borderWidth: 3,
                tension: 0.4,
                borderDash: (recoveryType === 'ABSORPTION_HP') ? [5, 5] : [],
                fill: false,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { display: true, text: chartTitle, font: { size: 14, weight: 'bold' } },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10,
                    callbacks: { label: (ctx) => `COP: ${ctx.raw}` }
                }
            },
            scales: {
                x: { title: { display: true, text: xLabel }, grid: { color: '#f1f5f9' } },
                y: { 
                    title: { display: true, text: 'COP' }, 
                    grid: { borderDash: [2, 2] }, 
                    min: 0,
                    // 动态调整 Y 轴上限，防止高 COP 被切
                    suggestedMax: (topology === 'RECOVERY' && recoveryType !== 'ABSORPTION_HP') ? 8.0 : undefined
                }
            }
        }
    });
}