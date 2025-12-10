// src/ui/charts.js
import Chart from 'chart.js/auto';
import { calculateCOP } from '../core/cycles.js';
import { MODES, TOPOLOGY, RECOVERY_TYPES } from '../core/constants.js';
import { getSatTempFromPressure } from '../core/physics.js';

let chartInstance = null;

export function updatePerformanceChart(state) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    const { 
        topology, mode, steamStrategy, recoveryType, perfectionDegree, 
        targetTemp, sourceTemp 
    } = state;

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";

    const realTargetTemp = (mode === MODES.STEAM) 
        ? getSatTempFromPressure(targetTemp) 
        : targetTemp;

    // === 1. 余热回收模式 (Scheme C) ===
    if (topology === TOPOLOGY.RECOVERY) {
        // [修复] X轴改为 "目标排烟温度" (30°C - 80°C)
        xLabel = "目标排烟温度 (Target Exhaust Out, °C)";
        
        const techName = (recoveryType === RECOVERY_TYPES.ABS) ? '吸收式' : 'MVR热泵';
        chartTitle = `深度回收特性: ${techName} (供热 ${realTargetTemp}°C)`;

        for (let tOut = 30; tOut <= 80; tOut += 5) {
            labels.push(tOut);
            
            // 物理假设：换热器端差 5K
            // 如果把排烟降到 tOut，那么热泵蒸发温度约为 tOut - 5
            const tEvap = tOut - 5.0; 
            const tCond = realTargetTemp + 5.0;

            const res = calculateCOP({
                evapTemp: tEvap,
                condTemp: tCond,
                efficiency: perfectionDegree,
                mode: mode,
                strategy: steamStrategy,
                recoveryType: recoveryType
            });
            dataCOP.push(res.error ? null : res.cop);
        }
    } 
    // === 2. 标准模式 (Scheme A/B) ===
    else {
        const stdRecType = RECOVERY_TYPES.MVR;

        if (mode === MODES.STEAM) {
            xLabel = "饱和蒸汽压力 (MPa,a)";
            chartTitle = `蒸汽工况 COP 趋势 (热源 ${sourceTemp}°C)`;
            for (let p = 0.1; p <= 1.2; p += 0.1) {
                const val = parseFloat(p.toFixed(1));
                labels.push(val);
                const tSat = getSatTempFromPressure(val);
                const res = calculateCOP({
                    evapTemp: sourceTemp - 5,
                    condTemp: tSat + 8,
                    efficiency: perfectionDegree,
                    mode: MODES.STEAM,
                    strategy: steamStrategy,
                    recoveryType: stdRecType 
                });
                dataCOP.push(res.error ? null : res.cop);
            }
        } else {
            xLabel = "环境/热源温度 (°C)";
            chartTitle = `变工况 COP 趋势 (供水 ${realTargetTemp}°C)`;
            for (let t = -20; t <= 40; t += 5) {
                labels.push(t);
                const res = calculateCOP({
                    evapTemp: t - 5,
                    condTemp: realTargetTemp + 5,
                    efficiency: perfectionDegree,
                    mode: MODES.WATER,
                    strategy: steamStrategy, 
                    recoveryType: stdRecType
                });
                dataCOP.push(res.error ? null : res.cop);
            }
        }
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'System COP',
                data: dataCOP,
                borderColor: (topology === TOPOLOGY.RECOVERY && recoveryType === RECOVERY_TYPES.ABS) ? '#f59e0b' : '#10b981', 
                borderWidth: 3,
                tension: 0.4,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: chartTitle },
                tooltip: { callbacks: { label: (c) => `COP: ${c.raw}` } }
            },
            scales: {
                y: { min: 0, suggestedMax: 6.0 },
                x: { title: { display: true, text: xLabel } }
            }
        }
    });
}