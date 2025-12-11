from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 引入我们刚才写的模块
from app.models import StandardCalcRequest, SchemeCRequest
from app.core.cycles import calculate_cop
from app.core.solver import SchemeCSolver

app = FastAPI()

# === 跨域配置 ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "System Online", "version": "v9.1-Python"}

# === 新增：标准计算接口 ===
@app.post("/calculate/standard")
def run_standard_simulation(data: StandardCalcRequest):
    """
    接收前端参数，计算 COP
    """
    # 1. 估算蒸发和冷凝温度
    t_evap = data.source_temp - 5.0
    t_cond = data.target_temp + 5.0
    
    # 2. 调用算法核心
    result = calculate_cop(
        evap_temp=t_evap,
        cond_temp=t_cond,
        efficiency=data.efficiency,
        mode=data.mode,
        strategy=data.strategy
    )
    
    # 3. 返回结果给前端
    return {
        "input_echo": {
            "source": data.source_temp,
            "target": data.target_temp
        },
        "simulation_result": result
    }

# === 新增：方案C 接口 ===
# 👇 这里必须顶格写，不能有空格！
@app.post("/calculate/scheme-c")
def run_scheme_c(data: SchemeCRequest):
    solver = SchemeCSolver()
    result = solver.solve(data)
    return result