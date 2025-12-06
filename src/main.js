// src/main.js - 交互控制层 (v2.2 Industrial + Digital Twin)

import './style.css'
// 导入核心计算逻辑
import { calculateHeatPumpCycle, calculateHybridStrategy, SYSTEM_CONFIG, FuelDatabase } from './logic.js'; 
// 导入图表引擎
import { updateChart } from './chartHelper.js';
// [新增] 导入 P&ID 绘图引擎
import { renderSystemDiagram } from './diagram.js'; 

// --- 1. DOM 元素获取 ---
const selectTopology = document.getElementById('select-topology');
const descTopology = document.getElementById('topology-desc');

const labelSourceTemp = document.getElementById('label-source-temp');
const inputTempSource = document.getElementById('input-temp-source');
const inputTempSupply = document.getElementById('input-temp-supply');
const inputLoad = document.getElementById('input-load');

const selectFuel = document.getElementById('select-fuel');
const labelFuelUnit = document.getElementById('label-fuel-unit');
const inputFuelPrice = document.getElementById('input-fuel-price');
const inputElecPrice = document.getElementById('input-elec-price');

const btnCalc = document.getElementById('btn-calculate');

// 结果显示区
const elCop = document.getElementById('res-cop');
const elRatio = document.getElementById('res-ratio');
const elPower = document.getElementById('res-power');
const elCost = document.getElementById('res-cost');
const logBox = document.getElementById('system-log');

// --- 2. 终端风格日志工具 ---
function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB'); 
    let colorClass = "text-green-400";
    let prefix = ">";

    if (type === 'error') { colorClass = "text-red-400"; prefix = "ERR:"; }
    if (type === 'warn') { colorClass = "text-yellow-400"; prefix = "WARN:"; }
    if (type === 'eco') { colorClass = "text-emerald-300 font-bold"; prefix = "ECO:"; } // 环保高亮
    
    const line = `<div class="${colorClass} border-l-2 border-transparent hover:border-slate-600 pl-1"><span class="opacity-40">[${time}]</span> ${prefix} ${msg}</div>`;
    logBox.innerHTML += line;
    logBox.scrollTop = logBox.scrollHeight;
}

// --- 3. UI 联动逻辑 ---

// A. 拓扑结构切换
selectTopology.addEventListener('change', (e) => {
    const mode = e.target.value;
    
    if (mode === 'PARALLEL') {
        // 方案 A: 传统环境源
        labelSourceTemp.innerText = "室外干球温度 (°C)";
        inputTempSource.value = "-5"; 
        log("SYS: 拓扑切换 -> [方案 A: 传统解耦]");
    } else {
        // 方案 B: 余热源
        labelSourceTemp.innerText = "工业余热/废热温度 (°C)";
        inputTempSource.value = String(SYSTEM_CONFIG.wasteHeatTemp); 
        log("SYS: 拓扑切换 -> [方案 B: 余热耦合]");
    }

    // ★ 立即刷新 SVG 流程图 (P&ID)
    renderSystemDiagram('diagram-container', {
        topology: mode,
        tSource: parseFloat(inputTempSource.value),
        tSupply: parseFloat(inputTempSupply.value)
    });
});

// B. 燃料类型切换
selectFuel.addEventListener('change', (e) => {
    const fuelKey = e.target.value;
    const fuelData = FuelDatabase[fuelKey];
    
    labelFuelUnit.innerText = `/${fuelData.unit}`;
    
    // 智能价格建议 (CNY)
    if (fuelKey === 'NATURAL_GAS') inputFuelPrice.value = "3.80";
    if (fuelKey === 'COAL') inputFuelPrice.value = "1.20"; 
    if (fuelKey === 'ELECTRICITY') inputFuelPrice.value = "0.75"; 
    
    log(`CFG: 辅助燃料变更为 [${fuelData.name}]`);
});

// --- 4. 核心计算主流程 ---
btnCalc.addEventListener('click', () => {
    // 安全检查
    if (!window.Module || !window.Module.PropsSI) {
        log("CoolProp 核心未加载，请刷新页面重试。", "error");
        return;
    }

    // 读取输入数据
    const topology = selectTopology.value;
    const tSource = parseFloat(inputTempSource.value); 
    const tSupply = parseFloat(inputTempSupply.value);
    const loadKW = parseFloat(inputLoad.value);
    const fuelKey = selectFuel.value;
    const ePrice = parseFloat(inputElecPrice.value);
    const fPrice = parseFloat(inputFuelPrice.value);

    log(`RUN: 开始仿真 [${topology}] | 热源=${tSource}°C | 供水=${tSupply}°C ...`);

    // 步骤 1: 物理热力循环计算
    const cycleRes = calculateHeatPumpCycle(tSource, tSupply, window.Module);

    if (cycleRes.error) {
        log(`物理计算失败: ${cycleRes.error}`, "error");
        updateUIError();
        return;
    }

    // 步骤 2: 经济与环境策略计算
    const strategy = calculateHybridStrategy({
        loadKW, 
        cop: cycleRes.cop, 
        elecPrice: ePrice, 
        fuelPrice: fPrice, 
        fuelTypeKey: fuelKey, 
        topology: topology
    });

    // 步骤 3: 更新界面结果
    updateUI(cycleRes, strategy);
    
    // 步骤 4: 更新智能图表 (传入 topology 以自动切换 X 轴维度)
    updateChart(topology, tSource, tSupply, window.Module);

    // ★ 步骤 5: 更新 P&ID 流程图 (确保显示的温度是最新计算值)
    renderSystemDiagram('diagram-container', {
        topology: topology,
        tSource: tSource,
        tSupply: tSupply
    });
});

/**
 * 界面更新函数
 */
function updateUI(phys, strat) {
    elCop.innerText = phys.cop;
    elRatio.innerText = strat.hpRatio;
    elPower.innerText = strat.powerKW.toFixed(1);
    elCost.innerText = strat.cost.toFixed(1);

    // 状态卡片颜色逻辑
    const ratioCard = elRatio.parentElement;
    // 重置所有颜色
    ratioCard.className = "bg-white p-4 rounded-xl shadow-sm border-t-4"; 
    
    if (strat.hpRatio === 100) {
        if (strat.mode.includes("余热")) {
            ratioCard.classList.add('border-purple-500'); // 紫色: 高级余热
        } else {
            ratioCard.classList.add('border-blue-500');   // 蓝色: 普通电驱
        }
    } else {
        ratioCard.classList.add('border-orange-500');     // 橙色: 燃料锅炉
    }

    // --- 详细日志输出 ---
    log(`完成: COP=${phys.cop} | 成本=¥${strat.cost.toFixed(1)}/h | 碳排=${strat.co2.toFixed(1)} kgCO2`, "info");

    // 计算对比优势 (如果当前是热泵运行，计算比锅炉省多少)
    if (strat.hpRatio === 100) {
        const comp = strat.comparison;
        const savedMoney = comp.boilerCost - comp.hpCost;
        const savedCo2 = comp.boilerCo2 - comp.hpCo2;

        if (savedMoney > 0) {
            log(`💰 经济效益: 相比锅炉每小时节省 ¥${savedMoney.toFixed(1)}`, "eco");
        }
        if (savedCo2 > 0) {
            log(`🌱 环保效益: 相比锅炉每小时减排 ${savedCo2.toFixed(1)} kgCO2`, "eco");
        }
    }
}

function updateUIError() {
    elCop.innerText = "--";
    elRatio.innerText = "--";
    elPower.innerText = "--";
    elCost.innerText = "--";
}

// --- 初始化动作 ---
// 1. 系统就绪日志
log("KERNEL: System Ready. (v2.2 Digital Twin)");

// 2. 绘制初始 P&ID 图
renderSystemDiagram('diagram-container', {
    topology: 'PARALLEL', // 默认初始化为传统模式
    tSource: -5,
    tSupply: 60
});