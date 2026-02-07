#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// 哪吒探针配置
const NEZHA_SERVER = process.env.NEZHA_SERVER || 'nzmbv.wuge.nyc.mn:443';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || 'gUxNJhaKJgceIgeapZG4956rmKFgmQgP';
const UUID = process.env.UUID || '749684ab-f2e5-4f3d-bc55-9fb3e60b4f07';

console.log('🚀 哪吒探针自动部署脚本');

let childProcess = null;

// -------------------------
// 辅助函数
// -------------------------

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    
    protocol.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`下载失败: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// -------------------------
// 检查并下载哪吒探针
// -------------------------
async function checkNezhaAgent() {
  if (!NEZHA_SERVER || !NEZHA_KEY) {
    console.error('❌ 缺少必要配置：需要 NEZHA_SERVER 和 NEZHA_KEY 环境变量');
    return false;
  }
  
  let arch = process.arch;
  switch (arch) {
    case 'x64':
      arch = 'amd64';
      break;
    case 'arm64':
      arch = 'arm64';
      break;
    case 'arm':
      arch = 'arm';
      break;
    case 'ia32':
      arch = '386';
      break;
    default:
      console.error(`❌ 不支持的架构: ${arch}`);
      return false;
  }
  
  let agentName, downloadUrl;
  
  if (NEZHA_PORT) {
    // 哪吒 v0
    agentName = 'nezha-agent-v0';
    if (fs.existsSync(agentName) && (fs.statSync(agentName).mode & 0o111)) {
      console.log('✅ 已找到 nezha-agent (v0)');
      return true;
    }
    
    console.log('📥 下载哪吒探针 v0 (agent)...');
    downloadUrl = (arch === 'arm64' || arch === 'arm') 
      ? 'https://arm64.ssss.nyc.mn/agent'
      : 'https://amd64.ssss.nyc.mn/agent';
  } else {
    // 哪吒 v1
    agentName = 'nezha-agent-v1';
    if (fs.existsSync(agentName) && (fs.statSync(agentName).mode & 0o111)) {
      console.log('✅ 已找到 nezha-agent (v1)');
      return true;
    }
    
    console.log('📥 下载哪吒探针 v1...');
    downloadUrl = (arch === 'arm64' || arch === 'arm')
      ? 'https://arm64.ssss.nyc.mn/v1'
      : 'https://amd64.ssss.nyc.mn/v1';
  }
  
  try {
    await downloadFile(downloadUrl, agentName);
    fs.chmodSync(agentName, 0o755);
    console.log('✅ nezha-agent 下载完成');
    return true;
  } catch (err) {
    console.error('❌ 哪吒探针下载失败:', err.message);
    return false;
  }
}

// -------------------------
// 生成哪吒 v1 配置文件
// -------------------------
function generateNezhaV1Config() {
  const portMatch = NEZHA_SERVER.match(/:(\d+)$/);
  const port = portMatch ? portMatch[1] : '';
  
  const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
  const nezhaTls = tlsPorts.includes(port);
  
  const config = `client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhaTls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}
`;
  
  fs.writeFileSync('config.yaml', config);
  console.log('✅ 哪吒 v1 配置文件已生成');
}

// -------------------------
// 运行哪吒探针
// -------------------------
function runNezhaAgent(version) {
  const agentPath = version === 'v0' ? './nezha-agent-v0' : './nezha-agent-v1';
  
  if (!fs.existsSync(agentPath)) {
    console.error(`❌ 未找到探针文件: ${agentPath}`);
    return;
  }
  
  console.log(`✅ 启动哪吒探针 (${version})...`);
  
  const logPath = path.join(__dirname, 'nezha-agent.log');
  
  const startAgent = () => {
    let args = [];
    
    if (version === 'v0') {
      const tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
      const needsTls = tlsPorts.includes(NEZHA_PORT);
      
      args = [
        '-s', `${NEZHA_SERVER}:${NEZHA_PORT}`,
        '-p', NEZHA_KEY,
        '--disable-auto-update',
        '--report-delay', '4',
        '--skip-conn',
        '--skip-procs'
      ];
      
      if (needsTls) {
        args.push('--tls');
      }
    } else {
      args = ['-c', 'config.yaml'];
    }
    
    // 写入启动日志
    const startLog = `[${new Date().toISOString()}] 启动哪吒 ${version}: ${agentPath} ${args.join(' ')}\n`;
    fs.appendFileSync(logPath, startLog);
    
    // 打开日志文件描述符
    const logFd = fs.openSync(logPath, 'a');
    
    // 保存子进程引用
    childProcess = spawn(agentPath, args, {
      stdio: ['ignore', logFd, logFd],
      detached: false
    });
    
    console.log(`📍 哪吒探针进程 PID: ${childProcess.pid}`);
    
    childProcess.on('exit', (code, signal) => {
      fs.close(logFd, () => {});
      const exitLog = `[${new Date().toISOString()}] 哪吒探针退出，退出码: ${code}, 信号: ${signal}\n`;
      fs.appendFileSync(logPath, exitLog);
      console.log(`⚠️  哪吒探针退出 (code: ${code}, signal: ${signal})，5秒后重启...`);
      childProcess = null;
      setTimeout(startAgent, 5000);
    });
    
    childProcess.on('error', (err) => {
      fs.close(logFd, () => {});
      const errorLog = `[${new Date().toISOString()}] 哪吒探针错误: ${err.message}\n`;
      fs.appendFileSync(logPath, errorLog);
      console.error(`❌ 哪吒探针错误: ${err.message}`);
      childProcess = null;
      setTimeout(startAgent, 5000);
    });
  };
  
  startAgent();
  
  // 延迟显示日志
  setTimeout(() => {
    if (fs.existsSync(logPath)) {
      console.log('📋 哪吒探针启动日志 (最近10行):');
      const log = fs.readFileSync(logPath, 'utf8');
      const lines = log.split('\n').filter(l => l.trim()).slice(-10);
      lines.forEach(line => {
        if (line) console.log('   ' + line);
      });
    }
  }, 2000);
}

// -------------------------
// 主函数
// -------------------------
async function main() {
  try {
    console.log('');
    console.log('⚙️  配置信息');
    console.log('========================================');
    console.log(`📡 哪吒服务器: ${NEZHA_SERVER}`);
    if (NEZHA_PORT) {
      console.log(`🔌 端口: ${NEZHA_PORT} (v0 模式)`);
    } else {
      console.log(`📌 版本: v1 模式`);
    }
    console.log(`🔑 密钥: ${NEZHA_KEY.substring(0, 8)}...`);
    console.log(`🆔 UUID: ${UUID}`);
    console.log('========================================');
    console.log('');
    
    // 下载并检查哪吒探针
    if (!await checkNezhaAgent()) {
      console.error('❌ 哪吒探针初始化失败');
      process.exit(1);
    }
    
    // 确定版本并生成配置
    let nezhaVersion = '';
    if (NEZHA_PORT) {
      nezhaVersion = 'v0';
      console.log('✅ 哪吒探针 v0 配置完成');
    } else {
      nezhaVersion = 'v1';
      generateNezhaV1Config();
      console.log('✅ 哪吒探针 v1 配置完成');
    }
    
    console.log('');
    console.log('🎉 准备启动哪吒探针...');
    console.log('');
    
    // 启动哪吒探针
    runNezhaAgent(nezhaVersion);
    
    // 保持进程运行 - 使用 setInterval 防止进程退出
    const keepAlive = setInterval(() => {
      // 每60秒输出一次状态
      if (childProcess && childProcess.pid) {
        console.log(`💓 哪吒探针运行中 (PID: ${childProcess.pid})`);
      } else {
        console.log(`⏳ 哪吒探针准备重启...`);
      }
    }, 60000);
    
    // 优雅退出处理
    const gracefulShutdown = (signal) => {
      console.log(`\n收到 ${signal} 信号，正在优雅关闭...`);
      clearInterval(keepAlive);
      
      if (childProcess && childProcess.pid) {
        console.log('正在停止哪吒探针...');
        childProcess.kill('SIGTERM');
        
        // 给子进程3秒时间优雅退出
        setTimeout(() => {
          if (childProcess && childProcess.pid) {
            console.log('强制终止哪吒探针...');
            childProcess.kill('SIGKILL');
          }
          process.exit(0);
        }, 3000);
      } else {
        process.exit(0);
      }
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // 捕获未处理的异常
    process.on('uncaughtException', (err) => {
      console.error('未捕获的异常:', err);
      // 不退出进程，继续运行
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('未处理的 Promise 拒绝:', reason);
      // 不退出进程，继续运行
    });
    
  } catch (err) {
    console.error('❌ 发生错误:', err.message);
    process.exit(1);
  }
}

// 启动程序
main();
