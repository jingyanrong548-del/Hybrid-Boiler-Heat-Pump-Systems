// src/main.js - v7.9 Steam Enhanced (UI Control & Wiring)

import './style.css'
import {
    calculateProcessCycle,
    calculateHybridStrategy,
    getSatTempFromPressure,
    SYSTEM_CONFIG,
    FuelDatabase,
    UNIT_CONVERTERS
} from './logic.js';
import { updateChart } from './chartHelper.js';
import { renderSystemDiagram } from './diagram.js';

// --- 1. DOM 元素获取 ---
const dom = {
    // 基础控制
    topo: document.getElementById('select-topology'),
    btnWater: document.getElementById('btn-mode-water'),
    btnSteam: document.getElementById('btn-mode-steam'),
    inpMode: document.getElementById('input-target-mode'),

    // 面板
    panelStd: document.getElementById('panel-input-standard'),
    panelRec: document.getElementById('panel-input-recovery'),

    // v7.9 新增控件
    boxSteamStrat: document.getElementById('box-steam-strategy'),
    selSteamStrat: document.getElementById('select-steam-strategy'),
    boxFeedParams: document.getElementById('box-feed-params'),
    inpTempFeed: document.getElementById('input-temp-feed'),
    divTempPre: document.getElementById('div-temp-pre'),
    inpTempPre: document.getElementById('input-temp-pre'),

    // 输入
    lblSource: document.getElementById('label-source-temp'),
    inpSource: document.getElementById('input-temp-source'),
    inpFlueIn: document.getElementById('input-flue-temp-in'),
    inpFlueOut: document.getElementById('input-flue-temp-out'),
    selRecType: document.getElementById('select-recovery-type'),
    lblTarget: document.getElementById('label-target-val'),
    inpTarget: document.getElementById('input-target-val'),
    unitTarget: document.getElementById('unit-target-val'),
    boxSteamInfo: document.getElementById('steam-info-box'),
    resSatTemp: document.getElementById('res-sat-temp'),
    inpLoad: document.getElementById('input-load'),
    inpAnnualHours: document.getElementById('input-annual-hours'),

    // 经济
    selFuel: document.getElementById('select-fuel'),
    inpElecPrice: document.getElementById('input-elec-price'),
    inpFuelPrice: document.getElementById('input-fuel-price'),
    lblFuelUnit: document.getElementById('label-fuel-unit'),
    inpCapexHP: document.getElementById('inp-capex-hp'),
    inpCapexBase: document.getElementById('inp-capex-base'),

    // 高级
    selPerfection: document.getElementById('sel-perfection'),
    boxPerfCustom: document.getElementById('box-perf-custom'),
    inpPerfCustom: document.getElementById('inp-perfection-custom'),
    chkManualCop: document.getElementById('chk-manual-cop'),
    inpManualCop: document.getElementById('inp-manual-cop'),
    inpPefElec: document.getElementById('inp-pef-elec'),

    inpFuelCal: document.getElementById('inp-fuel-cal'),
    selUnitCal: document.getElementById('sel-unit-cal'),
    inpFuelCo2: document.getElementById('inp-fuel-co2'),
    selUnitCo2: document.getElementById('sel-unit-co2'),
    inpFuelEff: document.getElementById('inp-fuel-eff'),

    // 结果
    btnCalc: document.getElementById('btn-calculate'),
    lblRes1: document.getElementById('lbl-res-1'),
    descRes1: document.getElementById('desc-res-1'),
    lblRes2: document.getElementById('lbl-res-2'),
    unitRes2: document.getElementById('unit-res-2'),
    lblRes3: document.getElementById('lbl-res-3'),
    descRes3: document.getElementById('desc-res-3'),
    resCop: document.getElementById('res-cop'),
    resLift: document.getElementById('res-lift'),
    resPratio: document.getElementById('res-pratio'),
    resPer: document.getElementById('res-per'),
    resCo2Red: document.getElementById('res-co2-red'),
    resCost: document.getElementById('res-cost'),
    resUnitCost: document.getElementById('res-unit-cost'),
    resAnnualSave: document.getElementById('res-annual-save'),
    resPayback: document.getElementById('res-payback'),
    log: document.getElementById('system-log')
};

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB');
    let clr = 'text-green-400';
    if (type === 'error') clr = 'text-red-400';
    if (type === 'warn') clr = 'text-yellow-400 font-bold';
    if (type === 'eco') clr = 'text-emerald-300 font-bold';
    if (dom.log) {
        dom.log.innerHTML += `<div class="${clr} border-l-2 border-transparent pl-1 hover:bg-slate-800"><span class="opacity-50">[${time}]</span> ${msg}</div>`;
        dom.log.scrollTop = dom.log.scrollHeight;
    }
}

// --- 配置联动 ---

function updateUnitOptions(fuelKey) {
    const db = FuelDatabase[fuelKey];
    const baseUnit = db.unit;
    const calOpts = [
        { val: 'kWh', txt: `kWh/${baseUnit}` },
        { val: 'MJ', txt: `MJ/${baseUnit}` },
        { val: 'kcal', txt: `kcal/${baseUnit}` },
        { val: 'GJ', txt: `GJ/${baseUnit}` }
    ];
    dom.selUnitCal.innerHTML = calOpts.map(o => `<option value="${o.val}">${o.txt}</option>`).join('');
    dom.selUnitCal.value = 'kWh';
    const co2Opts = [
        { val: 'kg/kWh', txt: `kg/kWh` },
        { val: 'kg/MJ', txt: `kg/MJ` },
        { val: 'kg/kcal', txt: `kg/kcal` }
    ];
    dom.selUnitCo2.innerHTML = co2Opts.map(o => `<option value="${o.val}">${o.txt}</option>`).join('');
    dom.selUnitCo2.value = 'kg/kWh';
}

dom.selFuel.addEventListener('change', (e) => {
    const key = e.target.value;
    const db = FuelDatabase[key];
    dom.lblFuelUnit.innerText = `/${db.unit}`;
    const priceMap = { 'NATURAL_GAS': 3.8, 'COAL': 1.2, 'DIESEL': 7.5, 'BIOMASS': 1.0, 'STEAM_PIPE': 220, 'ELECTRICITY': 0.75 };
    dom.inpFuelPrice.value = priceMap[key] || 1.0;
    const capexMap = { 'NATURAL_GAS': 200, 'COAL': 400, 'ELECTRICITY': 150, 'BIOMASS': 500, 'STEAM_PIPE': 50, 'DIESEL': 250 };
    dom.inpCapexBase.value = capexMap[key] || 200;
    updateUnitOptions(key);
    dom.inpFuelCal.value = db.calorificValue;
    dom.inpFuelCo2.value = db.co2Factor;
    dom.inpFuelEff.value = db.efficiency;
    prevCalUnit = 'kWh'; prevCo2Unit = 'kg/kWh';
    log(`CFG: 燃料切换至 [${db.name}]`);
});

let prevCalUnit = 'kWh';
dom.selUnitCal.addEventListener('focus', () => { prevCalUnit = dom.selUnitCal.value; });
dom.selUnitCal.addEventListener('change', () => {
    const val = parseFloat(dom.inpFuelCal.value);
    const fromFactor = UNIT_CONVERTERS[prevCalUnit] || 1.0;
    const toFactor = UNIT_CONVERTERS[dom.selUnitCal.value] || 1.0;
    const newVal = val * (toFactor / fromFactor);
    dom.inpFuelCal.value = parseFloat(newVal.toPrecision(5));
    prevCalUnit = dom.selUnitCal.value;
});

let prevCo2Unit = 'kg/kWh';
dom.selUnitCo2.addEventListener('focus', () => { prevCo2Unit = dom.selUnitCo2.value; });
dom.selUnitCo2.addEventListener('change', () => {
    const val = parseFloat(dom.inpFuelCo2.value);
    const fromBase = prevCo2Unit.split('/')[1];
    const toBase = dom.selUnitCo2.value.split('/')[1];
    const fromFactor = UNIT_CONVERTERS[fromBase] || 1.0;
    const toFactor = UNIT_CONVERTERS[toBase] || 1.0;
    const newVal = val * (fromFactor / toFactor);
    dom.inpFuelCo2.value = parseFloat(newVal.toPrecision(5));
    prevCo2Unit = dom.selUnitCo2.value;
});

// 🟢 v7.9 新增: 控制蒸汽策略面板的显隐
function updateSteamUI() {
    const topo = dom.topo.value;
    const mode = dom.inpMode.value;
    const strat = dom.selSteamStrat.value;

    // 1. 只有在 Recovery + Steam 模式下才显示策略选择器
    if (topo === 'RECOVERY' && mode === 'STEAM') {
        dom.boxSteamStrat.classList.remove('hidden');
        dom.boxFeedParams.classList.remove('hidden');
        
        // 2. 根据策略显示不同的补水参数
        if (strat === 'STRATEGY_PRE') {
            dom.divTempPre.classList.remove('hidden'); // 预热需要填目标温度
        } else {
            dom.divTempPre.classList.add('hidden');    // 直产蒸汽不需要填(用饱和温度)
        }
    } else {
        dom.boxSteamStrat.classList.add('hidden');
        dom.boxFeedParams.classList.add('hidden');
    }
}

// 监听策略改变
dom.selSteamStrat.addEventListener('change', updateSteamUI);

dom.topo.addEventListener('change', (e) => {
    const topo = e.target.value;
    if (topo === 'RECOVERY') {
        dom.panelStd.classList.add('hidden');
        dom.panelRec.classList.remove('hidden');
        dom.lblRes1.innerText = "余热热泵 COP";
        dom.descRes1.innerText = "Recovery HP Only";
        dom.lblRes2.innerText = "冷凝水回收 (Water)";
        dom.unitRes2.innerText = "t/h";
        dom.lblRes3.innerText = "系统综合效率";
        dom.descRes3.innerText = "Boiler + Recovery";
    } else {
        dom.panelStd.classList.remove('hidden');
        dom.panelRec.classList.add('hidden');
        dom.lblRes1.innerText = "系统 COP";
        dom.descRes1.innerText = "Performance";
        dom.lblRes2.innerText = "系统温升 (Lift)";
        dom.unitRes2.innerText = "K";
        dom.lblRes3.innerText = "一次能源利用率 (PER)";
        dom.descRes3.innerText = "Efficiency";
        if (topo === 'COUPLED') {
            dom.lblSource.innerText = "工业余热/废热温度";
            dom.inpSource.value = SYSTEM_CONFIG.wasteHeatTemp;
        } else {
            dom.lblSource.innerText = "室外干球温度";
            dom.inpSource.value = "-5";
        }
    }
    updateSteamUI(); // 触发UI更新
    updateDiagram();
});

function setTargetMode(mode) {
    dom.inpMode.value = mode;
    const isSteam = (mode === 'STEAM');
    dom.btnSteam.className = isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    dom.btnWater.className = !isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    if (isSteam) {
        dom.lblTarget.innerText = "目标饱和蒸汽压力";
        dom.inpTarget.value = "0.5"; dom.inpTarget.step = "0.1";
        dom.unitTarget.innerText = "MPa(a)";
        dom.boxSteamInfo.classList.remove('hidden');
        updateSatTempPreview();
    } else {
        dom.lblTarget.innerText = "目标供水/回水温度";
        dom.inpTarget.value = "60"; dom.inpTarget.step = "1";
        dom.unitTarget.innerText = "°C";
        dom.boxSteamInfo.classList.add('hidden');
    }
    updateSteamUI(); // 触发UI更新
}
dom.btnWater.addEventListener('click', () => setTargetMode('WATER'));
dom.btnSteam.addEventListener('click', () => setTargetMode('STEAM'));

dom.inpTarget.addEventListener('input', () => {
    if (dom.inpMode.value === 'STEAM') updateSatTempPreview();
});
function updateSatTempPreview() {
    const p = parseFloat(dom.inpTarget.value);
    const t = getSatTempFromPressure(p);
    dom.resSatTemp.innerText = `${t} °C`;
}

dom.selPerfection.addEventListener('change', (e) => {
    e.target.value === 'CUSTOM' ? dom.boxPerfCustom.classList.remove('hidden') : dom.boxPerfCustom.classList.add('hidden');
});
dom.chkManualCop.addEventListener('change', (e) => {
    dom.inpManualCop.disabled = !e.target.checked;
    e.target.checked ? dom.inpManualCop.classList.replace('bg-slate-100', 'bg-white') : dom.inpManualCop.classList.replace('bg-white', 'bg-slate-100');
});

// --- 计算核心 ---

dom.btnCalc.addEventListener('click', () => {
    const topo = dom.topo.value;
    const mode = dom.inpMode.value;
    const srcT = parseFloat(dom.inpSource.value);
    const tgtVal = parseFloat(dom.inpTarget.value);

    let perfDegree = (dom.selPerfection.value === 'CUSTOM') ? parseFloat(dom.inpPerfCustom.value) : parseFloat(dom.selPerfection.value);
    const isManualCop = dom.chkManualCop.checked;
    const manualCopVal = isManualCop ? parseFloat(dom.inpManualCop.value) : 0;

    log(`RUN: 仿真启动... [Topo: ${topo}]`);

    const cycle = calculateProcessCycle({
        mode, sourceTemp: srcT, targetVal: tgtVal, perfectionDegree: perfDegree
    });

    if (cycle.error) {
        log(cycle.error, 'error');
        dom.resCop.innerText = "Err";
        return;
    }

    const strat = calculateHybridStrategy({
        loadKW: parseFloat(dom.inpLoad.value),
        cop: cycle.cop,
        manualCop: manualCopVal,
        elecPrice: parseFloat(dom.inpElecPrice.value),
        fuelPrice: parseFloat(dom.inpFuelPrice.value),
        fuelTypeKey: dom.selFuel.value,
        topology: topo,
        customCalorific: parseFloat(dom.inpFuelCal.value),
        calUnit: dom.selUnitCal.value,
        customCo2: parseFloat(dom.inpFuelCo2.value),
        co2Unit: dom.selUnitCo2.value,
        customEfficiency: parseFloat(dom.inpFuelEff.value),
        annualHours: parseFloat(dom.inpAnnualHours.value),
        tExhaustIn: parseFloat(dom.inpFlueIn.value),
        tExhaustOut: parseFloat(dom.inpFlueOut.value),
        recoveryType: dom.selRecType.value,
        targetWaterTemp: (mode === 'STEAM' ? getSatTempFromPressure(tgtVal) : tgtVal),
        capexHP: parseFloat(dom.inpCapexHP.value),
        capexBase: parseFloat(dom.inpCapexBase.value),
        pefElec: parseFloat(dom.inpPefElec.value),
        perfectionDegree: perfDegree,

        // 🟢 v7.9 透传新参数
        steamStrategy: dom.selSteamStrat.value,
        tFeed: parseFloat(dom.inpTempFeed.value),
        tPre: parseFloat(dom.inpTempPre.value)
    });

    let displayCop = 0;
    if (isManualCop && manualCopVal > 0) {
        displayCop = manualCopVal;
    } else if (topo === 'RECOVERY') {
        displayCop = strat.activeCop;
    } else {
        displayCop = cycle.cop;
    }
    dom.resCop.innerText = displayCop;
    dom.resCo2Red.innerText = strat.co2Reduction.toFixed(1);

    let res3Value = (strat.per > 0 && strat.per < 100) ? strat.per : "--";
    let recoveredKW = 0;

    if (topo === 'RECOVERY') {
        // 🟢 v7.9 热汇限制警告逻辑
        if (strat.sinkLimited) {
            log(`⚠️ 热汇限制: 水流量不足, 实际排烟 ${strat.exhaustOutActual}°C`, 'warn');
        }

        dom.resLift.innerText = strat.waterRecovery > 0 ? strat.waterRecovery.toFixed(2) : "0.0";

        const baseEff = parseFloat(dom.inpFuelEff.value);
        const hpRatio = strat.hpRatio;
        const sysEff = baseEff * (1 + hpRatio / 100);

        dom.resPer.innerHTML = `
            <span class="text-slate-400 text-sm">${baseEff.toFixed(2)}</span>
            <span class="text-slate-300 mx-1">➔</span>
            <span class="text-xl text-violet-600 font-bold">${sysEff.toFixed(2)}</span>
        `;

        // Tooltip Logic
        const isAbs = (dom.selRecType.value === 'ABSORPTION_HP');
        const hintText = isAbs
            ? "💡 能量守恒：吸收式热泵消耗的驱动热量（蒸汽/燃气）在做功后并未消失，而是全部进入了供水系统，相当于'第二热源'，因此总热增益显著。"
            : "⚡️ 搬运机制：电动热泵仅消耗少量高品位电能来搬运低品位余热，系统增量主要纯来自于回收的余热本身。";

        dom.descRes3.innerHTML = `
            <div class="group relative flex items-center cursor-help">
                <span class="text-emerald-500 font-bold">Boost: +${(hpRatio * 1).toFixed(1)}%</span>
                <div class="ml-1 w-3 h-3 rounded-full border border-slate-400 text-slate-400 text-[8px] flex items-center justify-center">?</div>
                <span class="text-slate-400 text-[9px] ml-1">| PER:${strat.per}</span>
                
                <div class="hidden group-hover:block absolute bottom-full left-0 mb-2 w-56 bg-slate-800 text-white text-[10px] p-2.5 rounded shadow-xl z-50 font-normal leading-relaxed border border-slate-600 pointer-events-none">
                    ${hintText}
                    <div class="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-slate-800"></div>
                </div>
            </div>
        `;

        recoveredKW = parseFloat(dom.inpLoad.value) * (hpRatio / 100);

    } else {
        dom.resLift.innerText = cycle.lift.toFixed(1);
        if (dom.resPratio) dom.resPratio.innerText = cycle.pRatio.toFixed(1);
        dom.descRes3.innerText = "Efficiency";
        dom.resPer.innerText = res3Value;
    }

    dom.resCost.innerText = strat.cost.toFixed(1);
    dom.resUnitCost.innerText = strat.unitCost.toFixed(3);

    const annual = strat.annualSaving;
    dom.resAnnualSave.innerText = annual > 10000 ? `${(annual / 10000).toFixed(1)}万` : annual.toFixed(0);

    if (strat.paybackPeriod > 0 && strat.paybackPeriod < 20) {
        dom.resPayback.innerText = strat.paybackPeriod;
    } else {
        dom.resPayback.innerText = "--";
    }

    // 准备图表所需的真实目标温度
    const chartTargetTemp = (mode === 'STEAM') 
        ? getSatTempFromPressure(tgtVal) 
        : tgtVal;

    // 传递完善度和热泵类型给图表
    updateChart(topo, mode, srcT, chartTargetTemp, perfDegree, dom.selRecType.value);

    // 传递回收热量给拓扑图
    updateDiagram(recoveredKW);

    if (strat.hpRatio > 0) {
        log(`✅ [结果] ${strat.mode}`, 'eco');
        log(`📊 ROI: ${strat.paybackPeriod}年 | Boost: +${strat.hpRatio}%`, 'info');
    }
});

function updateDiagram(recoveredKW = 0) {
    renderSystemDiagram('diagram-container', {
        topology: dom.topo.value,
        tSource: parseFloat(dom.inpSource.value),
        tDisplaySource: dom.topo.value === 'RECOVERY' ? parseFloat(dom.inpFlueIn.value) : parseFloat(dom.inpSource.value),
        tSupply: dom.inpMode.value === 'STEAM' ? getSatTempFromPressure(parseFloat(dom.inpTarget.value)) : parseFloat(dom.inpTarget.value),
        recoveredKW: recoveredKW
    });
}

// Init
setTargetMode('WATER');
dom.selFuel.dispatchEvent(new Event('change'));
updateDiagram();