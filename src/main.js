import './style.css'
// 导入我们定义的两个逻辑函数
import { calculateHeatPumpCycle, calculateHybridStrategy } from './logic.js'; 
import { updateChart } from './chartHelper.js';

// 获取 DOM 元素
const btnCalc = document.getElementById('btn-calculate');
const inputTempOut = document.getElementById('input-temp-out');
const inputTempSupply = document.getElementById('input-temp-supply');
const inputLoad = document.getElementById('input-load');
const logBox = document.getElementById('system-log');

// 获取价格输入框
const inputElecPrice = document.getElementById('input-elec-price');
const inputGasPrice = document.getElementById('input-gas-price');

// 结果显示元素
const elCop = document.getElementById('res-cop');
const elRatio = document.getElementById('res-ratio');
const elPower = document.getElementById('res-power');
const elCost = document.getElementById('res-cost');

// 日志工具
function log(msg) {
    const time = new Date().toLocaleTimeString();
    logBox.innerHTML += `<div><span class="text-slate-400">[${time}]</span> ${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
}

log("系统就绪，等待用户指令...");

// 绑定按钮点击事件
btnCalc.addEventListener('click', () => {
    // 1. 检查 CoolProp 是否加载
    if (!window.Module || !window.Module.PropsSI) {
        log("❌ 错误：核心尚未加载完成，请稍候...");
        return;
    }

    // 2. 读取用户输入
    const tOut = parseFloat(inputTempOut.value);
    const tSupply = parseFloat(inputTempSupply.value);
    const loadKW = parseFloat(inputLoad.value);
    const ePrice = parseFloat(inputElecPrice.value);
    const gPrice = parseFloat(inputGasPrice.value);

    log(`>>> 开始计算: 室外 ${tOut}°C, 供水 ${tSupply}°C`);

    // 3. 调用热泵物理计算
    const result = calculateHeatPumpCycle(tOut, tSupply, window.Module);

    if (result.error) {
        log(`⚠️ 计算警告: ${result.error}`);
        elCop.innerText = "--";
        return;
    }

    // 4. 调用混合策略计算
    const strategy = calculateHybridStrategy(loadKW, result.cop, ePrice, gPrice);

    // 5. 更新界面显示
    elCop.innerText = result.cop;
    elRatio.innerText = strategy.hpRatio + "%";
    elPower.innerText = strategy.powerKW.toFixed(1);
    elCost.innerText = strategy.cost.toFixed(2);
    
    // 改变比率卡片的颜色来提示模式
    const ratioCard = elRatio.parentElement;
    // 先移除旧的颜色类
    ratioCard.classList.remove('border-blue-500', 'border-orange-500');
    
    if (strategy.hpRatio === 0) {
        ratioCard.classList.add('border-orange-500'); // 变橙色代表锅炉
        log(`🔥 切换为 [${strategy.mode}] (锅炉成本 $${strategy.cost.toFixed(2)})`);
    } else {
        ratioCard.classList.add('border-blue-500'); // 变蓝色代表热泵
        log(`⚡️ 保持 [${strategy.mode}] (热泵成本 $${strategy.cost.toFixed(2)})`);
    }

    // 6. 更新图表
    updateChart(tOut, tSupply, window.Module);
});