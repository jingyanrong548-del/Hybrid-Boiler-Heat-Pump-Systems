import math

# === 移植自 src/core/physics.js ===

def get_sat_temp_from_pressure(pressure_mpa: float) -> float:
    """
    根据绝对压力计算饱和温度 (R134a/Water 简化拟合)
    对应 JS: getSatTempFromPressure
    """
    if pressure_mpa <= 0:
        return 100.0
    
    # Antoine Equation approximation
    p_mmhg = pressure_mpa * 7500.62
    A, B, C = 8.07131, 1730.63, 233.426
    
    # 注意：Python 的 log10 在 math 库里
    val = B / (A - math.log10(p_mmhg)) - C
    return round(val, 1)

def estimate_enthalpy(temp_c: float, is_steam: bool = False) -> float:
    """
    估算焓值 (简化工程模型)
    对应 JS: estimateEnthalpy
    """
    if not is_steam:
        return 4.187 * temp_c  # Cp_water ≈ 4.187
    else:
        return 2676 + 0.5 * (temp_c - 100) # 饱和蒸汽基准 + 过热

# === 新增：燃烧物理修正 ===

def calculate_actual_flue_volume(theo_gas: float, theo_air: float, alpha: float) -> float:
    """
    计算实际烟气生成量 (考虑过量空气)
    公式: V_actual = V_theo + (alpha - 1) * V_air_theo
    """
    safe_alpha = max(1.0, alpha if alpha else 1.2)
    excess_air = (safe_alpha - 1.0) * theo_air
    return theo_gas + excess_air

def calculate_adjusted_dew_point(ref_dew_point: float, alpha: float) -> float:
    """
    计算修正后的露点温度
    工程近似: 过量空气系数每增加 0.1，露点下降约 1.7度
    """
    if not ref_dew_point or ref_dew_point <= 0: return 0.0
    
    safe_alpha = max(1.0, alpha if alpha else 1.2)
    K_DECAY = 17.0 # 衰减系数
    
    adjusted = ref_dew_point - K_DECAY * (safe_alpha - 1.0)
    return round(adjusted, 1)