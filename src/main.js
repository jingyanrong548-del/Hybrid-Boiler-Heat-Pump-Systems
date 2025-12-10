// src/main.js - v8.1.2 Fixed (Capacity Breakdown & Warnings)

import './style.css'
import {
    calculateProcessCycle,
    calculateHybridStrategy,
    getSatTempFromPressure,
    convertSteamTonsToKW,
    SYSTEM_CONFIG,
    FuelDatabase,
    UNIT_CONVERTERS
} from './logic.js';
import { updateChart } from './chartHelper.js';
import { renderSystemDiagram } from './diagram.js';

// --- 1. DOM 元素获取 ---
const dom = {
    topo: document.getElementById('select-topology'),
    btnWater: document.getElementById('btn-mode-water'),
    btnSteam: document.getElementById('btn-mode-steam'),
    inpMode: document.getElementById('input-target-mode'),
    panelStd: document.getElementById('panel-input-standard'),
    panelRec: document.getElementById('panel-input-recovery'),
    lblLoadIn: document.getElementById('label-load-in'),
    inpLoadIn: document.getElementById('input-load-in'),
    lblLoadOut: document.getElementById('label-load-out'),
    inpLoadOut: document.getElementById('input-load-out'),
    boxSteamStrat: document.getElementById('box-steam-strategy'), 
    selSteamStrat: document.getElementById('select-steam-strategy'),
    selRecType: document.getElementById('select-recovery-type'),
    selLoadUnit: document.getElementById('select-load-unit'),
    inpLoad: document.getElementById('input-load'),
    inpLoadTon: document.getElementById('input-load-ton'),
    unitLoadDisplay: document.getElementById('unit-load-display'),
    infoLoadConv: document.getElementById('info-load-converted'),
    valLoadConv: document.getElementById('val-load-converted'),
    lblSource: document.getElementById('label-source-temp'),
    inpSource: document.getElementById('input-temp-source'),
    inpFlueIn: document.getElementById('input-flue-temp-in'),
    inpFlueOut: document.getElementById('input-flue-temp-out'),
    boxTargetStd: document.getElementById('box-target-std'), 
    lblTarget: document.getElementById('label-target-val'),
    inpTarget: document.getElementById('input-target-val'),
    unitTarget: document.getElementById('unit-target-val'),
    boxSteamInfo: document.getElementById('steam-info-box'),
    resSatTemp: document.getElementById('res-sat-temp'),
    inpAnnualHours: document.getElementById('input-annual-hours'),
    selFuel: document.getElementById('select-fuel'),
    inpElecPrice: document.getElementById('input-elec-price'),
    inpFuelPrice: document.getElementById('input-fuel-price'),
    lblFuelUnit: document.getElementById('label-fuel-unit'),
    inpCapexHP: document.getElementById('inp-capex-hp'),
    inpCapexBase: document.getElementById('inp-capex-base'),
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
    btnCalc: document.getElementById('btn-calculate'),
    
    // Result Dashboard Elements
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
    
    // 🟢 New Capacity Breakdown Elements (v8.1.2)
    valCapTotal: document.getElementById('val-cap-total'),
    valCapTon: document.getElementById('val-cap-ton'),
    valCapBreakdown: document.getElementById('val-cap-breakdown'),

    log: document.getElementById('system-log'),
    btnGenReq: document.getElementById('btn-gen-req'),
    modalReq: document.getElementById('modal-requisition'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnCopyReq: document.getElementById('btn-copy-req'),
    reqSourceType: document.getElementById('req-source-type'),
    reqSourceIn: document.getElementById('req-source-in'),
    reqSourceOut: document.getElementById('req-source-out'),
    reqLoadType: document.getElementById('req-load-type'),
    reqLoadIn: document.getElementById('req-load-in'),
    reqLoadOut: document.getElementById('req-load-out'),
    reqCapacity: document.getElementById('req-capacity')
};

let currentResultStrategy = null; 

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

dom.selLoadUnit.addEventListener('change', (e) => {
    const unit = e.target.value;
    if (unit === 'TON') {
        dom.inpLoad.classList.add('hidden');
        dom.inpLoadTon.classList.remove('hidden');
        dom.unitLoadDisplay.innerText = 't/h';
        dom.infoLoadConv.classList.remove('hidden');
        updateLoadConversion();
    } else {
        dom.inpLoad.classList.remove('hidden');
        dom.inpLoadTon.classList.add('hidden');
        dom.unitLoadDisplay.innerText = 'kW';
        dom.infoLoadConv.classList.add('hidden');
    }
});

dom.inpLoadTon.addEventListener('input', updateLoadConversion);
dom.inpLoadIn.addEventListener('input', () => { if(dom.selLoadUnit.value==='TON') updateLoadConversion(); });

function updateLoadConversion() {
    const tons = parseFloat(dom.inpLoadTon.value) || 0;
    // v8.1.1 Fixed: 强制使用 1t=700kW 规则，忽略焓差计算
    const kw = convertSteamTonsToKW(tons); 
    dom.valLoadConv.innerText = kw.toLocaleString();
}

function updateLoadUI() {
    const topo = dom.topo.value;
    const mode = dom.inpMode.value;
    const steamStrat = dom.selSteamStrat ? dom.selSteamStrat.value : 'STRATEGY_PRE';

    if (topo === 'RECOVERY') {
        dom.panelStd.classList.add('hidden');
        dom.boxTargetStd.classList.add('hidden');
        dom.panelRec.classList.remove('hidden');

        if (mode === 'WATER') {
            dom.lblLoadIn.innerText = "回水温度 (Return)";
            dom.lblLoadOut.innerText = "供水温度 (Supply)";
            dom.boxSteamStrat.classList.add('hidden'); 
            
            if (dom.inpLoadIn.value == "20" || dom.inpLoadIn.value == "") dom.inpLoadIn.value = "50";
            if (dom.inpLoadOut.value == "90" || dom.inpLoadOut.value == "") dom.inpLoadOut.value = "70";

        } else {
            dom.lblLoadIn.innerText = "补水温度 (Feed)";
            dom.boxSteamStrat.classList.remove('hidden');

            if (steamStrat === 'STRATEGY_PRE') {
                dom.lblLoadOut.innerText = "预热目标温度 (Pre-heat)";
                if (dom.inpLoadIn.value == "50") dom.inpLoadIn.value = "20";
                dom.inpLoadOut.value = "90"; 
            } else {
                dom.lblLoadOut.innerText = "蒸汽饱和温度 (Sat. Target)";
                if (dom.inpLoadIn.value == "50") dom.inpLoadIn.value = "20";
                const satT = getSatTempFromPressure(parseFloat(dom.inpTarget.value));
                dom.inpLoadOut.value = satT;
            }
        }
    } else {
        dom.panelRec.classList.add('hidden');
        dom.panelStd.classList.remove('hidden');
        dom.boxTargetStd.classList.remove('hidden');
        dom.boxSteamStrat.classList.add('hidden');
    }
    
    if (dom.selLoadUnit.value === 'TON') updateLoadConversion();
}

if (dom.selSteamStrat) dom.selSteamStrat.addEventListener('change', updateLoadUI);
dom.topo.addEventListener('change', () => {
    updateLoadUI();
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
    updateLoadUI(); 
}
dom.btnWater.addEventListener('click', () => setTargetMode('WATER'));
dom.btnSteam.addEventListener('click', () => setTargetMode('STEAM'));

dom.inpTarget.addEventListener('input', () => {
    if (dom.inpMode.value === 'STEAM') {
        updateSatTempPreview();
        if (dom.selSteamStrat && dom.selSteamStrat.value === 'STRATEGY_GEN' && dom.topo.value === 'RECOVERY') {
            dom.inpLoadOut.value = getSatTempFromPressure(parseFloat(dom.inpTarget.value));
        }
    }
    if(dom.selLoadUnit.value==='TON') updateLoadConversion();
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

dom.btnCalc.addEventListener('click', () => {
    const topo = dom.topo.value;
    const mode = dom.inpMode.value;
    const srcT = parseFloat(dom.inpSource.value);
    const tgtVal = parseFloat(dom.inpTarget.value);

    const tLoadIn = parseFloat(dom.inpLoadIn.value);
    const tLoadOut = parseFloat(dom.inpLoadOut.value);

    let finalLoadKW = 0;
    if (dom.selLoadUnit.value === 'TON') {
        const tons = parseFloat(dom.inpLoadTon.value);
        // v8.1.1 Fixed: 使用标准转换
        finalLoadKW = convertSteamTonsToKW(tons);
        log(`⚡️ 负荷折算 (Fixed): ${tons} t/h = ${finalLoadKW} kW`, 'info');
    } else {
        finalLoadKW = parseFloat(dom.inpLoad.value);
    }

    let perfDegree = (dom.selPerfection.value === 'CUSTOM') ? parseFloat(dom.inpPerfCustom.value) : parseFloat(dom.selPerfection.value);
    const isManualCop = dom.chkManualCop.checked;
    const manualCopVal = isManualCop ? parseFloat(dom.inpManualCop.value) : 0;

    log(`RUN: 仿真启动... [Topo: ${topo}]`, 'info');

    const cycle = calculateProcessCycle({
        mode, sourceTemp: srcT, targetVal: tgtVal, perfectionDegree: perfDegree
    });

    if (cycle.error) {
        log(cycle.error, 'error');
        dom.resCop.innerText = "Err";
        return;
    }

    const strat = calculateHybridStrategy({
        loadKW: finalLoadKW,
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

        steamStrategy: dom.selSteamStrat ? dom.selSteamStrat.value : 'STRATEGY_PRE',
        tLoadIn: tLoadIn,   
        tLoadOut: tLoadOut,
        targetMode: mode 
    });

    currentResultStrategy = strat;

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
        if (strat.sinkLimited) {
            log(`⚠️ 热汇限制: 水量不足, 排烟仅降至 ${strat.exhaustOutActual}°C`, 'warn');
        } else {
            log(`✅ 热平衡: 排烟降至 ${strat.exhaustOutActual}°C`, 'eco');
        }

        dom.resLift.innerText = (strat.lift !== undefined) ? strat.lift.toFixed(1) : "--";
        if(dom.unitRes2) dom.unitRes2.innerText = "K";

        const baseEff = parseFloat(dom.inpFuelEff.value);
        const hpRatio = strat.hpRatio;
        const sysEff = baseEff * (1 + hpRatio / 100);

        dom.resPer.innerHTML = `
            <span class="text-slate-400 text-sm">${baseEff.toFixed(2)}</span>
            <span class="text-slate-300 mx-1">➔</span>
            <span class="text-xl text-violet-600 font-bold">${sysEff.toFixed(2)}</span>
        `;

        const isAbs = (dom.selRecType.value === 'ABSORPTION_HP');
        const hintText = isAbs
            ? "💡 吸收式原理：驱动热量未消失，而是作为'第二热源'汇入供水，实现 >100% 综合效率。"
            : "⚡️ 电动原理：消耗电能搬运余热，系统增量纯来自于回收的物理热量。";

        dom.descRes3.innerHTML = `
            <div class="group relative flex items-center cursor-help">
                <span class="text-emerald-500 font-bold">Boost: +${(hpRatio * 1).toFixed(1)}%</span>
                <div class="ml-1 w-3 h-3 rounded-full border border-slate-400 text-slate-400 text-[8px] flex items-center justify-center">?</div>
                
                <div class="hidden group-hover:block absolute bottom-full left-0 mb-2 w-56 bg-slate-800 text-white text-[10px] p-2.5 rounded shadow-xl z-50 font-normal leading-relaxed border border-slate-600 pointer-events-none">
                    ${hintText}
                    <div class="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-slate-800"></div>
                </div>
            </div>
        `;

        recoveredKW = finalLoadKW * (hpRatio / 100);

        if (strat.reqData) {
            dom.btnGenReq.disabled = false;
            dom.btnGenReq.classList.remove('opacity-50', 'cursor-not-allowed');
            dom.btnGenReq.classList.add('cursor-pointer');
        }

    } else {
        dom.resLift.innerText = cycle.lift.toFixed(1);
        if (dom.resPratio) dom.resPratio.innerText = cycle.pRatio.toFixed(1);
        dom.descRes3.innerText = "Efficiency";
        dom.resPer.innerText = res3Value;
        
        dom.btnGenReq.disabled = true;
        dom.btnGenReq.classList.add('opacity-50', 'cursor-not-allowed');
    }

    // 🟢 v8.1.2 New: 产能拆解与警告显示
    // 1. 更新总产能显示
    if (dom.valCapTotal) {
        dom.valCapTotal.innerText = finalLoadKW.toLocaleString();
    }
    // 2. 更新蒸吨拆解
    if (dom.valCapBreakdown && strat.tonData) {
        dom.valCapTon.innerText = strat.tonData.total.toFixed(1);
        dom.valCapBreakdown.innerHTML = `
            <div class="flex items-center gap-3 text-[10px] sm:text-xs">
                <div class="flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full bg-slate-300"></span>
                    <span class="text-slate-500 font-medium">Boiler: <b class="text-slate-700">${strat.tonData.boiler}</b> t/h</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span class="text-emerald-600 font-medium">HP: <b class="text-emerald-700">${strat.tonData.hp}</b> t/h</span>
                </div>
            </div>
        `;
    }
    // 3. 低温排烟警告
    if (strat.isLowTempExhaust) {
        log('⚠️ 检测到低温排烟 (<90°C)，建议将基准锅炉效率调至 >95%', 'warn');
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

    const chartTargetTemp = (topo === 'RECOVERY') ? tLoadOut : 
                            (mode === 'STEAM' ? getSatTempFromPressure(tgtVal) : tgtVal);

    updateChart(topo, mode, srcT, chartTargetTemp, perfDegree, dom.selRecType.value);
    
    const diagramSupplyT = (topo === 'RECOVERY') ? tLoadOut :
                           (mode === 'STEAM' ? getSatTempFromPressure(tgtVal) : tgtVal);
    
    renderSystemDiagram('diagram-container', {
        topology: dom.topo.value,
        tSource: parseFloat(dom.inpSource.value),
        tDisplaySource: topo === 'RECOVERY' ? parseFloat(dom.inpFlueIn.value) : parseFloat(dom.inpSource.value),
        tSupply: diagramSupplyT,
        recoveredKW: recoveredKW
    });
});

function updateDiagram(recoveredKW = 0) {
    renderSystemDiagram('diagram-container', {
        topology: dom.topo.value,
        tSource: -5,
        tDisplaySource: dom.topo.value === 'RECOVERY' ? 130 : -5,
        tSupply: 60,
        recoveredKW: 0
    });
}

dom.btnGenReq.addEventListener('click', () => {
    if (!currentResultStrategy || !currentResultStrategy.reqData) {
        log('请先运行仿真以生成数据', 'warn');
        return;
    }
    const d = currentResultStrategy.reqData;
    
    dom.reqSourceType.innerText = d.sourceType;
    dom.reqSourceIn.innerText = d.sourceIn.toFixed(1);
    dom.reqSourceOut.innerText = d.sourceOut.toFixed(1);
    
    dom.reqLoadType.innerText = d.loadType;
    dom.reqLoadIn.innerText = d.loadIn.toFixed(1);
    dom.reqLoadOut.innerText = d.loadOut.toFixed(1);
    dom.reqCapacity.innerText = d.capacity.toLocaleString();

    dom.modalReq.classList.remove('hidden');
});

dom.btnCloseModal.addEventListener('click', () => {
    dom.modalReq.classList.add('hidden');
});

dom.btnCopyReq.addEventListener('click', () => {
    if (!currentResultStrategy) return;
    const d = currentResultStrategy.reqData;
    const text = `
【工业热泵选型参数确认书】
项目名称: IES仿真项目
---
1. 热源侧
介质: ${d.sourceType}
入口温度: ${d.sourceIn.toFixed(1)} °C
出口温度: ${d.sourceOut.toFixed(1)} °C
估算流量: ${d.sourceFlow} m³/h

2. 负荷侧
目标工况: ${d.loadType}
入口温度: ${d.loadIn.toFixed(1)} °C
目标温度: ${d.loadOut.toFixed(1)} °C
制热量需求: ${d.capacity.toLocaleString()} kW
---
生成的选型建议 (v8.1.2 Patch)
    `.trim();
    
    navigator.clipboard.writeText(text).then(() => {
        dom.btnCopyReq.innerText = "已复制!";
        setTimeout(() => dom.btnCopyReq.innerText = "复制文本", 2000);
    });
});

setTargetMode('WATER');
dom.selFuel.dispatchEvent(new Event('change'));