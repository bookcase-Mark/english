// -------------------------------------------------------------------------
    // 1. 数据源与变量
    // -------------------------------------------------------------------------
    let processedData = [];
    let filteredData = [];
    let markedWords = new Set(JSON.parse(localStorage.getItem('vocab_marked') || '[]'));
    
    let currentPage = 1;
    let itemsPerPage = 20;

    // 转盘相关
    let wheelData = [];        
    let wheelEliminated = new Set(); 
    let wheelMode = 'en_cn';   
    let isSpinning = false;
    let currentCardIndex = -1; 

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
            // 在列表页：如果勾选了隐藏，则隐藏；但在转盘里我们永远排除已掌握的
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

            // 注意：这里HTML结构稍微调整以配合CSS Grid (class添加)
            tr.innerHTML = `
                <td>
                    <button class="check-btn ${isMarked ? 'active' : ''}" 
                            onclick="toggleMark('${item.word.replace(/'/g, "\\'")}')"
                            aria-label="Mark as mastered">✓</button>
                </td>
                <td>
                    <div class="word-group">
                        <span class="word-text">${item.word}</span>
                        <span class="speaker-icon" onclick="speak('${item.word.replace(/'/g, "\\'")}')">🔊</span>
                    </div>
                    <div class="phonetic-text">${item.phonetic || ''}</div>
                </td>
                <td><span class="pos-badge">${item.pos || ''}</span></td>
                <td>${item.meaning}</td>
                <td>
                    <div style="margin-bottom:4px;">${item.sentence || ''}</div>
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
        
        // 更新 UI (不一定要重绘整个表，但为了简单逻辑直接重绘)
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

    // -------------------------------------------------------------------------
    // 2. 超级转盘逻辑 (包含移动端适配和严格过滤)
    // -------------------------------------------------------------------------
    
    window.openWheel = function() {
        const overlay = document.getElementById('wheelOverlay');
        overlay.style.display = 'flex';
        
        // 【关键修复】锁定背景滚动，防止PC端出现双滚动条
        document.body.style.overflow = 'hidden'; 

        // 数据检查逻辑
        const hasDirtyData = wheelData.some(item => markedWords.has(item.word.toLowerCase()));
        if (wheelData.length === 0 || hasDirtyData) {
            refreshWheelRandomly();
        } else {
            drawWheel();
        }
    }

    window.closeWheel = function() {
        const overlay = document.getElementById('wheelOverlay');
        overlay.style.display = 'none';
        
        // 【关键修复】恢复背景滚动
        document.body.style.overflow = '';
        
        document.getElementById('flashcard').classList.remove('show');
    }

    window.setWheelMode = function(mode) {
        if (wheelMode === mode) return;
        wheelMode = mode;
        
        document.getElementById('modeEnCn').classList.toggle('active', mode==='en_cn');
        document.getElementById('modeCnEn').classList.toggle('active', mode==='cn_en');
        
        // 切换模式不一定要换词，重绘即可
        drawWheel();
    }

    window.refreshWheelRandomly = function() {
        wheelEliminated.clear();
        
        // 1. 严格过滤：全量数据 - 已掌握
        const pool = processedData.filter(i => !markedWords.has(i.word.toLowerCase()));
        
        if (pool.length === 0) {
            alert("太棒了！所有单词都已掌握 (或词库为空)。");
            closeWheel();
            return;
        }

        // 2. 洗牌算法 (Fisher-Yates)
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        
        // 3. 取前 20-50 个 (移动端建议数量少一点，转盘字才看得清，这里设为 max 24)
        const count = window.innerWidth < 600 ? 16 : 24; 
        wheelData = pool.slice(0, count);
        
        updateWheelStats();
        drawWheel();
    }

    function updateWheelStats() {
        const left = wheelData.length - wheelEliminated.size;
        document.getElementById('wheelStats').innerText = `剩余: ${left}`;
    }

    // 高清屏 Canvas 绘制
    function drawWheel() {
        const canvas = document.getElementById('wheelCanvas');
        const ctx = canvas.getContext('2d');
        const count = wheelData.length;
        
        // 获取 CSS 显示尺寸
        const rect = canvas.getBoundingClientRect();
        // 适配高清屏 (Retina)
        const dpr = window.devicePixelRatio || 1;
        
        // 设置画布的实际像素大小
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        // 标准化坐标系
        ctx.scale(dpr, dpr);
        
        const size = rect.width; // 逻辑宽高
        const center = size / 2;
        const radius = size / 2 - 10; 
        const arc = (2 * Math.PI) / count;
        
        const colors = ['#FFB7B2', '#FFDAC1', '#E2F0CB', '#B5EAD7', '#C7CEEA', '#95a5a6'];

        ctx.clearRect(0,0, size, size);
        ctx.font = "bold 14px Arial"; 
        if(window.innerWidth > 600) ctx.font = "bold 18px Arial";
        
        ctx.textBaseline = 'middle';

        for(let i=0; i<count; i++) {
            const angle = i * arc;
            ctx.beginPath();
            ctx.moveTo(center, center);
            ctx.arc(center, center, radius, angle, angle + arc);
            
            if (wheelEliminated.has(i)) {
                ctx.fillStyle = '#cbd5e1'; 
            } else {
                ctx.fillStyle = colors[i % colors.length];
            }
            
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.stroke();

            // 绘制文字
            if (!wheelEliminated.has(i)) {
                ctx.save();
                ctx.translate(center, center);
                ctx.rotate(angle + arc / 2);
                ctx.textAlign = "right";
                ctx.fillStyle = "#334155";
                
                let text = wheelMode === 'en_cn' ? wheelData[i].word : wheelData[i].meaning;
                // 截断长文字
                const maxLen = window.innerWidth < 600 ? 8 : 12;
                if(text.length > maxLen) text = text.substring(0, maxLen-1) + "..";
                
                ctx.fillText(text, radius - 20, 0);
                ctx.restore();
            }
        }
    }

    window.spinWheel = function() {
        if(isSpinning) return;
        if (wheelEliminated.size >= wheelData.length) {
            if(confirm("本轮单词已全部完成！是否来一组新的？")) {
                refreshWheelRandomly();
            }
            return;
        }

        isSpinning = true;
        document.getElementById('spinBtn').disabled = true;
        document.getElementById('flashcard').classList.remove('show');

        // 随机选一个未消除的
        let winningIndex;
        let safety = 0;
        do {
            winningIndex = Math.floor(Math.random() * wheelData.length);
            safety++;
        } while (wheelEliminated.has(winningIndex) && safety < 1000);

        currentCardIndex = winningIndex;

        // 计算角度
        const arcDegrees = 360 / wheelData.length;
        const targetAngle = winningIndex * arcDegrees + arcDegrees / 2;
        
        // 至少转 5 圈 (1800度)
        let rotate = 360 * 5 + (360 - targetAngle); // 修正旋转逻辑为顺时针累加
        
        // 为了让 CSS 动画每次都触发，我们需要重置 transform 或 累加 rotate 值
        // 简单做法：每次基于当前 rotation 增加
        // 这里用一个临时变量存总旋转角度会更好，但为了保持无状态，我们假定初始为0
        
        const canvas = document.getElementById('wheelCanvas');
        // 先重置 transition 以便瞬间归零（如果需要），但这里我们希望它是累加的视觉效果？
        // 最简单的 CSS 旋转实现：
        
        // 修正：计算结束时的 transform 角度
        // 注意：canvas 的 0 度通常在右侧 (3点钟)，arc 也是从 0 开始
        // 我们的绘制是从 0 (3点钟) 开始顺时针。
        // 要让 winningIndex 指针(顶部 12点/270度) 停下，
        // 实际上是把画布旋转，让该扇区转到 270 度位置。
        
        let finalRotation = 270 - (winningIndex * arcDegrees + arcDegrees/2);
        // 保证是正向旋转很多圈
        while(finalRotation < 0) finalRotation += 360;
        finalRotation += 1800; // +5圈
        
        // 加一点随机偏移防止每次都在正中间
        const jitter = (Math.random() - 0.5) * (arcDegrees * 0.6);
        finalRotation += jitter;

        canvas.style.transition = 'transform 3s cubic-bezier(0.1, 0.7, 0.1, 1)';
        canvas.style.transform = `rotate(${finalRotation}deg)`;

        setTimeout(() => {
            isSpinning = false;
            document.getElementById('spinBtn').disabled = false;
            // 动画结束后，为了下次旋转不出现 "回退"，应该重置 transform 但保持视觉位置
            // 这里为了简化，我们仅展示卡片。下次旋转前会重绘 canvas，视觉上是新的开始。
            // 但如果不重置 style.transform，下次赋值必须比这次大。
            // 简单黑客：我们在 openWheel 时或 drawWheel 时重置 transform = 'none'
            showFlashcard(wheelData[winningIndex]);
        }, 3000);
    };
    
    // 每次绘制前重置旋转角度，避免 CSS 累加值的复杂计算
    const originalDrawWheel = drawWheel;
    drawWheel = function() {
        const canvas = document.getElementById('wheelCanvas');
        canvas.style.transition = 'none';
        canvas.style.transform = 'rotate(0deg)';
        originalDrawWheel();
    }

    function showFlashcard(item) {
        const qEl = document.getElementById('cardQuestion');
        const hEl = document.getElementById('cardHint');
        const aEl = document.getElementById('cardAnswer');
        
        document.querySelector('.answer-mask').classList.remove('revealed');

        if (wheelMode === 'en_cn') {
            qEl.innerText = item.word;
            hEl.innerText = `${item.pos} (请回忆中文)`;
            aEl.innerHTML = `
                <div style="font-size:1.4rem; color:var(--primary); font-weight:bold; margin-bottom:10px;">${item.meaning}</div>
                <div style="font-style:italic; color:#666; font-size:0.95rem;">${item.sentence}</div>
                <div style="font-size:0.85rem; color:#999;">${item.translation}</div>
            `;
            setTimeout(() => speak(item.word), 100);
        } else {
            qEl.innerText = item.meaning;
            hEl.innerText = "请拼写英文单词";
            aEl.innerHTML = `
                <div style="font-size:1.8rem; font-weight:bold; color:var(--primary); margin-bottom:5px;">${item.word}</div>
                <div style="color:#666; font-family:sans-serif;">${item.phonetic}</div>
                <div style="margin-top:10px; font-style:italic; font-size:0.9rem; color:#666;">${item.sentence}</div>
            `;
        }

        document.getElementById('flashcard').classList.add('show');
    }

    window.revealAnswer = function() {
        document.querySelector('.answer-mask').classList.add('revealed');
        if (wheelMode === 'cn_en') speak(wheelData[currentCardIndex].word);
    }

    window.speakCurrentCard = function() {
        if(currentCardIndex !== -1) speak(wheelData[currentCardIndex].word);
    }

    window.cardAction = function(type) {
        document.getElementById('flashcard').classList.remove('show');
        
        if (type === 'got') {
            // 如果用户在这里说“记住了”，我们要：
            // 1. 在转盘中剔除 (变灰)
            wheelEliminated.add(currentCardIndex);
            
            // 2. [可选] 是否同时也永久标记为“已掌握”？
            // 通常逻辑是：转盘里的“记住了”是本轮游戏记住了。
            // 但如果用户想永久移除，可以取消下面这行的注释：
            // toggleMark(wheelData[currentCardIndex].word); 
            
            updateWheelStats();
            drawWheel(); 
        }
    }

    // 监听窗口大小变化以重绘转盘 (适配横竖屏切换)
    window.addEventListener('resize', () => {
        if(document.getElementById('wheelOverlay').style.display === 'flex') {
             drawWheel();
        }
    });

    init();
