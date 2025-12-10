// src/state/store.js
import { TOPOLOGY, MODES, STRATEGIES, RECOVERY_TYPES } from '../core/constants.js';

// 初始状态定义
const initialState = {
    // === 系统架构 ===
    topology: TOPOLOGY.RECOVERY, // 默认方案 C (烟气回收)
    
    // === 核心工艺模式 ===
    mode: MODES.WATER,
    steamStrategy: STRATEGIES.PREHEAT,
    recoveryType: RECOVERY_TYPES.ABS, // 默认吸收式
    
    // === 关键温度参数 (°C) ===
    // 1. 热源侧
    sourceTemp: 35.0,        // 方案 A/B: 环境/余热源入口温度 (In)
    sourceOut: 30.0,         // [New] 方案 B: 余热源出口温度 (Out)
    
    flueIn: 130.0,           // 方案 C: 初始排烟温度
    flueOut: 40.0,           // 方案 C: 目标排烟温度
    excessAir: 1.20,         // [v9.1] 燃烧过量空气系数 (Alpha)

    // 2. 热汇/负载侧
    targetTemp: 60.0,        // 系统最终目标温度 (热水供水 / 蒸汽饱和温度)
    
    loadIn: 50.0,            // 方案 C: 补水/回水入口温度
    loadOut: 70.0,           // 方案 C: 热泵预热目标/出口温度
    
    loadInStd: 50.0,         // [New] 方案 A/B: 专用的热汇入口温度 (回水/补水)

    // === 负荷与效率 ===
    loadValue: 2000.0,       // 设计热负荷 (kW)
    loadUnit: 'KW',          // KW | TON
    loadValueTons: 2.86,     // (2000/700) 初始蒸吨值
    perfectionDegree: 0.45,  // 热力完善度
    
    // === [New] 手动 COP 控制 ===
    isManualCop: false,      // 是否启用手动 COP 锁定
    manualCop: 3.5,          // 手动 COP 值
    
    // === [New] 高级燃料参数 (覆盖默认值) ===
    fuelCalValue: 10.0,      // 低位热值 (LHV)
    fuelCalUnit: 'MJ/kg',    // LHV 单位 (仅用于 UI 显示和转换逻辑)
    fuelCo2Value: 0.202,     // CO2 排放因子
    fuelCo2Unit: 'kgCO2/unit', // CO2 单位
    
    // === 经济性参数 ===
    fuelType: 'NATURAL_GAS',
    elecPrice: 0.75,         // 电价 (元/kWh)
    fuelPrice: 3.80,         // 燃料单价
    annualHours: 6000,       // 年运行小时
    boilerEff: 0.92,         // 锅炉效率
    
    // === 造价估算 ===
    capexHP: 2500,           // 热泵单位造价 (元/kW)
    capexBase: 200           // 锅炉单位造价 (元/kW)
};

class Store {
    constructor() {
        this.state = { ...initialState };
        this.listeners = new Set();
    }

    /**
     * 获取当前状态快照
     */
    getState() {
        return this.state;
    }

    /**
     * 更新状态并通知订阅者
     * @param {Object} partialState - 部分更新的状态对象
     */
    setState(partialState) {
        const prevState = { ...this.state };
        this.state = { ...this.state, ...partialState };
        
        // 只要状态更新就通知 UI 重绘
        this.notify(prevState);
    }

    /**
     * 订阅状态变化
     * @param {Function} listener - 回调函数 (newState, prevState) => void
     * @returns {Function} unsubscribe - 取消订阅函数
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * 触发所有监听器
     */
    notify(prevState) {
        this.listeners.forEach(listener => listener(this.state, prevState));
    }
    
    /**
     * 重置为初始状态
     */
    reset() {
        this.setState(initialState);
    }
}

// 导出单例，确保全应用共享同一个 Store
export const store = new Store();