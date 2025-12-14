# 本地后端启动指南

## 快速启动

### 方法 1：使用虚拟环境（推荐）

```bash
# 1. 进入后端目录
cd ies_backend

# 2. 创建虚拟环境（如果还没有）
python3 -m venv venv

# 3. 激活虚拟环境
# macOS/Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# 4. 安装依赖
pip install -r requirements.txt

# 5. 启动服务器
python main.py
# 或者使用 uvicorn 直接启动：
# uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 方法 2：直接启动（如果已安装依赖）

```bash
# 1. 进入后端目录
cd ies_backend

# 2. 启动服务器
python main.py
```

## 验证后端是否运行

启动成功后，你应该看到类似以下的输出：

```
INFO:     Started server process [xxxxx]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

## 测试后端连接

### 方法 1：浏览器测试
打开浏览器访问：http://localhost:8000

应该看到：
```json
{"status": "System Online", "version": "v9.1-Python"}
```

### 方法 2：命令行测试
```bash
curl http://localhost:8000
```

## 常见问题

### 问题 1：端口 8000 已被占用

**解决方案：**
```bash
# 查找占用 8000 端口的进程
lsof -i :8000  # macOS/Linux
# 或
netstat -ano | findstr :8000  # Windows

# 然后使用其他端口启动
uvicorn main:app --reload --port 8001
```

### 问题 2：依赖安装失败

**解决方案：**
```bash
# 升级 pip
pip install --upgrade pip

# 然后重新安装依赖
pip install -r requirements.txt
```

### 问题 3：Python 版本不兼容

**要求：** Python 3.7+

**检查版本：**
```bash
python3 --version
```

### 问题 4：模块导入错误

**解决方案：**
确保在 `ies_backend` 目录下运行：
```bash
cd ies_backend
python main.py
```

## 停止服务器

按 `Ctrl + C` 停止服务器

## 开发模式（自动重载）

如果需要代码修改后自动重载，使用：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API 端点

- `GET /` - 健康检查
- `POST /calculate/standard` - 标准计算
- `POST /calculate/scheme-c` - 方案 C 计算
