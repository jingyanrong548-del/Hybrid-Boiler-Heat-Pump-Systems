// src/chartHelper.js - v8.1.1 Fixed (Logic Synced)

import Chart from 'chart.js/auto';
import { calculateProcessCycle, getSatTempFromPressure } from './logic.js';

let chartInstance = null;

export function updateChart(topology, targetMode, tSource, tCurrentTarget, perfectionDegree, recoveryType) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";
    
    // 🟢 1. 确保完善度与主逻辑一致
    const eta = perfectionDegree || 0.45;
    const etaDisplay = eta.toFixed(2);

    // 🟢 2. 获取 UI 上的目标排烟温度 (用于对齐主逻辑)
    const domFlueOut = document.getElementById('input-flue-temp-out');
    const targetExhaustOut = domFlueOut ? parseFloat(domFlueOut.value) : 40;

    // tCurrentTarget 在 main.js 中已经被转换为“真实温度”
    // (蒸汽模式下为饱和温度，热水模式下为供水温度)

    if (topology === 'RECOVERY') {
        xLabel = "初始排烟温度 (Exhaust In, °C)";
        
        const techName = recoveryType === 'ABSORPTION_HP' ? '吸收式 (Absorption)' : '电动式 (MVR)';
        const targetDesc = targetMode === 'STEAM' ? `蒸汽饱和温 ${tCurrentTarget}°C` : `供水 ${tCurrentTarget}°C`;
        
        chartTitle = `余热回收性能: ${techName} (${targetDesc}, η=${etaDisplay})`;

        // 绘制排烟温度从 60°C 到 180°C 的 COP 趋势
        for (let tIn = 60; tIn <= 180; tIn += 10) {
            labels.push(tIn);
            
            if (recoveryType === 'ABSORPTION_HP') {
                // 吸收式 COP 相对恒定
                const baseCop = (targetMode === 'STEAM') ? 1.45 : 1.70;
                dataCOP.push(baseCop); 
            } else {
                // 电动式计算 - 🟢 核心修正：对齐 logic.js 算法
                
                // 1. 确定实际排烟出口温度
                // 如果入口温度低于设定的目标出口(例如 40)，则实际出口只能是入口温度(无法回收)
                // 否则，按设定的目标出口计算(模拟设计点性能，不考虑 SinkLimited)
                let tOutActual = targetExhaustOut;
                if (tIn < tOutActual) tOutActual = tIn - 5; 

                // 2. 确定蒸发与冷凝温度 (与 logic.js calculateFlueGasRecovery 保持公式一致)
                // 逻辑假设：喷淋塔/中间回路使得蒸发温度略高于排烟出口 (Scrubber effect)
                const tEvap = tOutActual + 8.0; 
                const tCond = tCurrentTarget + 5.0;
                
                // 3. 物理硬约束
                if (tEvap >= tCond - 2) { 
                    dataCOP.push(null); // 无法制热
                } else {
                    const tk_evap = tEvap + 273.15;
                    const tk_cond = tCond + 273.15;
                    let cop_carnot = tk_cond / (tk_cond - tk_evap);
                    
                    // 限制 Carnot 极值
                    if (cop_carnot > 15) cop_carnot = 15;
                    
                    // 4. 温升惩罚 (Lift Penalty) - 仅在大温升蒸汽工况启用
                    let liftPenalty = 1.0;
                    if (targetMode === 'STEAM' && (tCond - tEvap) > 80) {
                        liftPenalty = 0.85; 
                    }

                    let real_cop = cop_carnot * eta * liftPenalty;
                    
                    // 5. 边界清洗
                    if (real_cop < 1) real_cop = 1;
                    if (real_cop > 8) real_cop = 8; // 视觉截断
                    
                    dataCOP.push(parseFloat(real_cop.toFixed(2)));
                }
            }
        }

    } else if (targetMode === 'STEAM') {
        // 标准蒸汽模式 (X轴 = 压力)
        xLabel = "饱和蒸汽压力 (MPa,a)";
        chartTitle = `蒸汽工况 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        
        for (let p = 0.1; p <= 1.2; p += 0.1) {
            let val = parseFloat(p.toFixed(1));
            labels.push(val);
            // 直接调用 logic.js 的标准循环计算
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

    // 确定 Y 轴建议最大值，优化视觉体验
    let suggestedMax = undefined;
    if (topology === 'RECOVERY') {
         if (recoveryType !== 'ABSORPTION_HP') suggestedMax = 8.0; 
         else suggestedMax = 2.5; 
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'COP',
                data: dataCOP,
                // 根据技术类型改变颜色
                borderColor: (recoveryType === 'ABSORPTION_HP') ? '#f59e0b' : 
                             (topology === 'RECOVERY' ? '#10b981' : (targetMode === 'STEAM' ? 'rgb(236, 72, 153)' : 'rgb(79, 70, 229)')), 
                backgroundColor: 'rgba(255, 255, 255, 0.0)',
                borderWidth: 3,
                tension: 0.4,
                borderDash: (recoveryType === 'ABSORPTION_HP') ? [5, 5] : [],
                fill: false,
                pointRadius: 4,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { 
                    display: true, 
                    text: chartTitle, 
                    font: { size: 14, weight: 'bold', family: "'JetBrains Mono', monospace" },
                    color: '#475569'
                },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10,
                    titleFont: { size: 13 },
                    bodyFont: { size: 13, weight: 'bold' },
                    callbacks: { label: (ctx) => `COP: ${ctx.raw}` }
                }
            },
            scales: {
                x: { 
                    title: { display: true, text: xLabel, font: { size: 12 } }, 
                    grid: { color: '#f1f5f9' } 
                },
                y: { 
                    title: { display: true, text: 'COP', font: { weight: 'bold' } }, 
                    grid: { borderDash: [2, 2], color: '#e2e8f0' }, 
                    min: 0,
                    suggestedMax: suggestedMax
                }
            }
        }
    });
}