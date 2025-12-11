# app/core/cycles.py
# 移植自 src/core/cycles.js

def calculate_cop(evap_temp: float, cond_temp: float, efficiency: float, 
                  mode: str, strategy: str) -> dict:
    """
    统一 COP 计算引擎
    """
    # 1. 基础物理检查
    if evap_temp < -30.0: return {"cop": 1.0, "error": "蒸发温度过低"}
    if cond_temp > 160.0: return {"cop": 1.0, "error": "冷凝温度过高"}
    
    # 2. 温升 (Lift) 计算
    lift = cond_temp - evap_temp
    if lift <= 10.0: 
        return {"cop": 8.0, "lift": lift, "error": "温差过小"}

    # 3. 卡诺循环基准 (Carnot)
    t_evap_k = evap_temp + 273.15
    t_cond_k = cond_temp + 273.15
    cop_carnot = t_cond_k / (t_cond_k - t_evap_k)
    
    # 物理极值限制
    if cop_carnot > 15: cop_carnot = 15

    # 4. 温升惩罚 (Lift Penalty) - 复刻 JS 逻辑
    lift_penalty = 1.0
    # 如果是蒸汽模式且直接产汽，且温升 > 80度，效率打折
    if mode == 'STEAM' and strategy == 'STRATEGY_GEN' and lift > 80:
        lift_penalty = 0.85

    # 5. 最终计算
    real_cop = cop_carnot * efficiency * lift_penalty

    # 6. 边界清洗
    real_cop = max(1.0, min(8.0, real_cop))

    return { 
        "cop": round(real_cop, 2), 
        "lift": round(lift, 1),
        "error": None
    }