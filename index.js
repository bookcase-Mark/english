// -------------------------------------------------------------------------
// 1. 数据源与变量
// -------------------------------------------------------------------------
let processedData = [];
let filteredData = [];
let markedWords = new Set(JSON.parse(localStorage.getItem('vocab_marked') || '[]'));

let currentPage = 1;
let itemsPerPage = 20;

// -------------------------------------------------------------------------
// 初始化与基础功能
// -------------------------------------------------------------------------
function init() {
    processData();
    applyFilters();

    document.getElementById('searchInput').addEventListener('input', () => { currentPage=1; applyFilters(); });
    document.getElementById('hideMarkedCheckbox').addEventListener('change', () => { currentPage=1; applyFilters(); });
    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
        itemsPerPage = parseInt(e.target.value);
        currentPage = 1;
        renderTable();
    });
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

window.speak = function(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; 
    utterance.rate = 1.0;     
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

// 启动
init();
