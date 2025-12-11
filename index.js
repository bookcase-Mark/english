// -------------------------------------------------------------------------
// 1. 数据源与变量
// -------------------------------------------------------------------------
let processedData = [];
let filteredData = [];
let markedWords = new Set(JSON.parse(localStorage.getItem('vocab_marked') || '[]'));

let currentPage = 1;
let itemsPerPage = 20;

// 语音相关变量
let preferredVoice = null;
let voices = [];

// -------------------------------------------------------------------------
// 初始化与基础功能
// -------------------------------------------------------------------------
function init() {
    processData();
    applyFilters();
    
    // 初始化语音（浏览器加载语音列表是异步的，需要监听）
    initVoices();
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = initVoices;
    }

    document.getElementById('searchInput').addEventListener('input', () => { currentPage=1; applyFilters(); });
    document.getElementById('hideMarkedCheckbox').addEventListener('change', () => { currentPage=1; applyFilters(); });
    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
        itemsPerPage = parseInt(e.target.value);
        currentPage = 1;
        renderTable();
    });
}

// 自动寻找最“真人”的语音包
function initVoices() {
    if (!window.speechSynthesis) return;
    
    // 获取所有可用语音
    voices = window.speechSynthesis.getVoices();
    
    // 筛选策略：优先找"Natural"(自然)、"Google"(谷歌)、"Enhanced"(增强)等关键词的英语语音
    // 这些通常是云端优化过或系统自带的高级语音
    const voicePriorities = [
        v => v.name.includes("Google US English"),       // Chrome/Android 常用高质量语音
        v => v.name.includes("Natural") && v.lang.includes("en-US"), // Edge/Windows 高级自然语音
        v => v.name.includes("Samantha"),                // macOS/iOS 常用好听语音
        v => v.name.includes("Enhanced") && v.lang.includes("en"), // iOS 增强语音
        v => v.lang === "en-US" && v.default             // 兜底：默认美式英语
    ];

    for (let check of voicePriorities) {
        const found = voices.find(check);
        if (found) {
            preferredVoice = found;
            console.log("已激活语音:", found.name); // 可以在控制台看到实际选用了哪个
            break;
        }
    }
}

function processData() {
    const map = new Map();
    if(typeof rawData !== 'undefined') {
        rawData.forEach(item => {
            if(item.word) map.set(item.word.toLowerCase().trim(), item);
        });
    }
    processedData = Array.from(map.values());
}

function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase().trim();
    const hideMarked = document.getElementById('hideMarkedCheckbox').checked;

    filteredData = processedData.filter(item => {
        const key = item.word.toLowerCase();
        if (hideMarked && markedWords.has(key)) return false;
        if (search && !key.includes(search) && !item.meaning.includes(search)) return false;
        return true;
    });

    renderTable();
    updatePagination();
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';
    
    const start = (currentPage - 1) * itemsPerPage;
    const pageData = filteredData.slice(start, start + itemsPerPage);

    if(pageData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">无符合条件的数据</td></tr>`;
        return;
    }

    pageData.forEach(item => {
        const isMarked = markedWords.has(item.word.toLowerCase());
        const tr = document.createElement('tr');
        if (isMarked) tr.classList.add('marked');

        const safeWord = item.word.replace(/'/g, "\\'");
        const safeSentence = (item.sentence || '').replace(/'/g, "\\'");

        tr.innerHTML = `
            <td>
                <button class="check-btn ${isMarked ? 'active' : ''}" 
                        onclick="toggleMark('${safeWord}')"
                        aria-label="Mark as mastered">✓</button>
            </td>
            <td>
                <div class="word-group">
                    <span class="word-text">${item.word}</span>
                    <span class="speaker-icon" onclick="speak('${safeWord}')">🔊</span>
                </div>
                <div class="phonetic-text">${item.phonetic || ''}</div>
            </td>
            <td><span class="pos-badge">${item.pos || ''}</span></td>
            <td>${item.meaning}</td>
            <td>
                <div style="margin-bottom:4px;">
                    ${item.sentence || ''} 
                    ${item.sentence ? `<span class="sentence-speaker" onclick="speak('${safeSentence}')" title="朗读例句">🔊</span>` : ''}
                </div>
                <div style="color:#999; font-size:0.85rem;">${item.translation || ''}</div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.toggleMark = function(word) {
    const key = word.toLowerCase();
    if (markedWords.has(key)) markedWords.delete(key);
    else markedWords.add(key);
    
    localStorage.setItem('vocab_marked', JSON.stringify(Array.from(markedWords)));
    applyFilters(); 
}

// -------------------------------------------------------------------------
// 优化后的朗读功能
// -------------------------------------------------------------------------
window.speak = function(text) {
    if (!window.speechSynthesis) return;
    
    // 如果还没加载到语音，尝试再次加载
    if (!preferredVoice) initVoices();

    window.speechSynthesis.cancel(); // 打断当前正在说的
    const utterance = new SpeechSynthesisUtterance(text);
    
    // 应用选中的最佳语音
    if (preferredVoice) {
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang; // 确保语言匹配
    } else {
        utterance.lang = 'en-US'; // 兜底
    }

    // 微调参数：0.9 的语速通常比默认 1.0 更适合语言学习，听起来更清晰沉稳
    utterance.rate = 0.9; 
    utterance.pitch = 1.0; 
    
    window.speechSynthesis.speak(utterance);
}

window.changePage = function(delta) {
    const max = Math.ceil(filteredData.length / itemsPerPage) || 1;
    currentPage += delta;
    if(currentPage < 1) currentPage = 1;
    if(currentPage > max) currentPage = max;
    renderTable();
    updatePagination();
    window.scrollTo({top:0, behavior:'smooth'});
}

function updatePagination() {
    const max = Math.ceil(filteredData.length / itemsPerPage) || 1;
    document.getElementById('pageInfo').innerText = `${currentPage} / ${max}`;
    document.getElementById('prevBtn').disabled = (currentPage === 1);
    document.getElementById('nextBtn').disabled = (currentPage === max);
}

init();
