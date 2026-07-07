// 초기 타임테이블 데이터 (비어 있음)
let timetable = [];

let lastPdfVersion = '';
let lastTxtVersion = '';
let lastLoadedSource = ''; // 'pdf' or 'txt'

const defaultSettings = {
    clock24h: true,
    showSeconds: true,
    accentColor: '#60a5fa',
    dangerColor: '#f87171',
    bgColor: '#080808',
    textColor: '#f5f5f5',
    clockSize: 7.0,
    timetableSize: 1.0,
    showDeleteBtn: true,
    autoScroll: true
};
let settings = { ...defaultSettings };

async function checkServerUpdates() {
    try {
        const t = Date.now();
        
        // 1. schedule.txt와 schedule.pdf의 헤더 정보 가져오기
        const [txtHead, pdfHead] = await Promise.all([
            fetch('schedule.txt?t=' + t, { method: 'HEAD' }).catch(() => null),
            fetch('schedule.pdf?t=' + t, { method: 'HEAD' }).catch(() => null)
        ]);

        let hasTxt = txtHead && txtHead.ok;
        let hasPdf = pdfHead && pdfHead.ok;

        if (!hasTxt && !hasPdf) {
            console.log("서버에서 schedule.txt와 schedule.pdf를 모두 찾을 수 없습니다.");
            return;
        }

        const txtVersion = hasTxt ? (txtHead.headers.get('ETag') || txtHead.headers.get('Last-Modified')) : '';
        const pdfVersion = hasPdf ? (pdfHead.headers.get('ETag') || pdfHead.headers.get('Last-Modified')) : '';

        // 수정 시간 비교용 날짜 변환
        const txtMtime = hasTxt ? new Date(txtHead.headers.get('Last-Modified') || 0).getTime() : 0;
        const pdfMtime = hasPdf ? new Date(pdfHead.headers.get('Last-Modified') || 0).getTime() : 0;

        // 어느 파일을 로드할지 결정 (더 최신 파일 사용)
        let sourceToLoad = '';
        if (hasTxt && hasPdf) {
            sourceToLoad = txtMtime >= pdfMtime ? 'txt' : 'pdf';
        } else if (hasTxt) {
            sourceToLoad = 'txt';
        } else {
            sourceToLoad = 'pdf';
        }

        // 버전 변경 여부 확인
        let needsUpdate = false;
        if (sourceToLoad === 'txt') {
            if (txtVersion !== lastTxtVersion || lastLoadedSource !== 'txt') {
                needsUpdate = true;
            }
        } else if (sourceToLoad === 'pdf') {
            if (pdfVersion !== lastPdfVersion || lastLoadedSource !== 'pdf') {
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            lastTxtVersion = txtVersion;
            lastPdfVersion = pdfVersion;
            lastLoadedSource = sourceToLoad;

            if (sourceToLoad === 'txt') {
                console.log("schedule.txt 로드 중 (더 최신이거나 유일한 소스)...");
                const response = await fetch('schedule.txt?t=' + t);
                if (response.ok) {
                    const text = await response.text();
                    const newTimetable = processParsedText(text);
                    updateTimetableData(newTimetable, '텍스트 파일(schedule.txt)에서 일정을 불러왔습니다.');
                }
            } else {
                console.log("schedule.pdf 로드 중 (더 최신이거나 유일한 소스)...");
                const response = await fetch('schedule.pdf?t=' + t);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                    blob.name = 'schedule.pdf';
                    parsePDF(blob);
                }
            }
        }
    } catch (e) {
        console.error("서버 데이터 동기화 감시 중 에러:", e);
    }
}

function init() {
    loadSettings();
    applySettings();
    initSettingsUI();

    // 로컬 스토리지에서 저장된 시간표 불러오기
    const savedTimetable = localStorage.getItem('savedTimetable');
    if (savedTimetable) {
        try {
            timetable = JSON.parse(savedTimetable);
            const dropZoneText = document.getElementById('drop-zone-text');
            if (dropZoneText) {
                dropZoneText.innerHTML = '저장된 시간표를 불러왔습니다.<br>새 PDF를 드래그 앤 드롭하여 변경할 수 있습니다.';
            }
        } catch (e) {
            console.error('저장된 시간표 로드 중 에러:', e);
        }
    }

    updateClock();
    setInterval(updateClock, 1000);
    
    // 웹 환경인 경우 처음에 읽어오고, 1분마다 서버의 파일 변경 여부를 감시 (자동 갱신)
    checkServerUpdates();
    setInterval(checkServerUpdates, 60000);
    
    renderTimetable();
    setupDropZone();
    
    // 월페이퍼 엔진 마우스 휠 스크롤 우회용 드래그 스크롤 기능
    const timetableContainer = document.getElementById('timetable-list');
    let isDown = false;
    let startY;
    let scrollTop;

    timetableContainer.addEventListener('mousedown', (e) => {
        isDown = true;
        startY = e.pageY - timetableContainer.offsetTop;
        scrollTop = timetableContainer.scrollTop;
        timetableContainer.style.cursor = 'grabbing';
    });
    timetableContainer.addEventListener('mouseleave', () => {
        isDown = false;
        timetableContainer.style.cursor = 'default';
    });
    timetableContainer.addEventListener('mouseup', () => {
        isDown = false;
        timetableContainer.style.cursor = 'default';
    });
    timetableContainer.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const y = e.pageY - timetableContainer.offsetTop;
        const walk = (y - startY) * 1.5;
        timetableContainer.scrollTop = scrollTop - walk;
    });
}

function updateClock() {
    const now = new Date();
    
    // 실시간 시계 업데이트
    let hoursVal = now.getHours();
    let ampm = '';
    if (!settings.clock24h) {
        ampm = hoursVal >= 12 ? ' PM' : ' AM';
        hoursVal = hoursVal % 12;
        hoursVal = hoursVal ? hoursVal : 12; // 0 should be 12
    }
    const hours = String(hoursVal).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = settings.showSeconds ? ':' + String(now.getSeconds()).padStart(2, '0') : '';
    
    document.getElementById('clock').textContent = `${hours}:${minutes}${seconds}${ampm}`;

    // 다음 일정 남은 시간 계산
    updateCountdown(now);
}

function updateCountdown(now) {
    const currentTimestamp = now.getTime();
    
    let currentEvent = null;
    let currentEventEndDiff = Infinity;
    
    let nextEvent = null;
    let nextEventDiff = Infinity;

    for (const event of timetable) {
        let startTs = event.timestamp;
        let endTs = 0;
        
        if (!startTs) {
            // fallback timestamp 계산
            const todayStr = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
            if (event.day === todayStr || event.day === 'Today') {
                const [h, m] = event.time.split(':').map(Number);
                startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
                event.fallbackTs = startTs; // 임시 타임스탬프 저장
                
                if (event.endTime) {
                    const [eh, em] = event.endTime.split(':').map(Number);
                    endTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em).getTime();
                    event.fallbackEndTs = endTs;
                }
            }
        } else {
            if (event.endTime) {
                let dateTimeStr = `${event.dateStr} ${event.endTime}`;
                if (event.dateStr.includes('-')) {
                    dateTimeStr = `${event.dateStr}T${event.endTime}:00`;
                }
                endTs = new Date(dateTimeStr).getTime();
            }
        }

        if (startTs) {
            // 1. 진행 중인 일정 확인 (시작 시각 이후이며 종료 시각 미만인 경우)
            if (endTs && currentTimestamp >= startTs && currentTimestamp < endTs) {
                currentEvent = event;
                currentEventEndDiff = Math.floor((endTs - currentTimestamp) / 1000);
            }
            
            // 2. 다음 일정 확인
            const diffSeconds = Math.floor((startTs - currentTimestamp) / 1000);
            if (diffSeconds > 0 && diffSeconds < nextEventDiff) {
                nextEvent = event;
                nextEventDiff = diffSeconds;
            }
        }
    }

    const countdownEl = document.getElementById('countdown');

    // 케이스 1: 진행 중인 일정과 다음 일정 둘 다 있는 경우
    if (currentEvent && currentEventEndDiff !== Infinity && nextEvent) {
        const ch = Math.floor(currentEventEndDiff / 3600);
        const cm = Math.floor((currentEventEndDiff % 3600) / 60);
        const cs = currentEventEndDiff % 60;
        let cTimeStr = '';
        if (ch > 0) cTimeStr += `${ch}h `;
        cTimeStr += `${cm}m ${cs}s`;

        const nd = Math.floor(nextEventDiff / (24 * 3600));
        const nh = Math.floor((nextEventDiff % (24 * 3600)) / 3600);
        const nm = Math.floor((nextEventDiff % 3600) / 60);
        const ns = nextEventDiff % 60;
        let nTimeStr = '';
        if (nd > 0) nTimeStr += `${nd}d `;
        if (nh > 0 || nd > 0) nTimeStr += `${nh}h `;
        nTimeStr += `${nm}m ${ns}s`;

        countdownEl.innerHTML = `
            <div class="current-event-countdown" style="margin-bottom: 20px;">
                <span style="font-size: 2.4rem; font-weight: 600; color: var(--danger); display: block;">-${cTimeStr}</span>
                <span style="opacity: 0.7; font-size: 0.7em; text-transform: uppercase; display: block; margin-top: 5px; letter-spacing: 1px;">NOW: ${currentEvent.label}</span>
            </div>
            <div class="next-event-countdown">
                <span style="font-size: 1.6rem; font-weight: 400; color: var(--text-main); display: block;">-${nTimeStr}</span>
                <span style="opacity: 0.7; font-size: 0.7em; text-transform: uppercase; display: block; margin-top: 5px; letter-spacing: 1px;">Next: ${nextEvent.label}</span>
            </div>
        `;
    }
    // 케이스 2: 진행 중인 일정만 있는 경우 (다음 일정이 없음)
    else if (currentEvent && currentEventEndDiff !== Infinity) {
        const ch = Math.floor(currentEventEndDiff / 3600);
        const cm = Math.floor((currentEventEndDiff % 3600) / 60);
        const cs = currentEventEndDiff % 60;
        let cTimeStr = '';
        if (ch > 0) cTimeStr += `${ch}h `;
        cTimeStr += `${cm}m ${cs}s`;

        countdownEl.innerHTML = `
            <div class="current-event-countdown">
                <span style="font-size: 3rem; font-weight: 600; color: var(--danger); display: block;">-${cTimeStr}</span>
                <span style="opacity: 0.7; font-size: 0.7em; text-transform: uppercase; display: block; margin-top: 5px; letter-spacing: 1px;">NOW: ${currentEvent.label}</span>
            </div>
        `;
    }
    // 케이스 3: 다음 일정만 있는 경우 (기존과 100% 동일하게 렌더링)
    else if (nextEvent) {
        const d = Math.floor(nextEventDiff / (24 * 3600));
        const h = Math.floor((nextEventDiff % (24 * 3600)) / 3600);
        const m = Math.floor((nextEventDiff % 3600) / 60);
        const s = nextEventDiff % 60;
        let timeStr = '';
        if (d > 0) timeStr += `${d}d `;
        if (h > 0 || d > 0) timeStr += `${h}h `;
        timeStr += `${m}m ${s}s`;

        countdownEl.innerHTML = `-${timeStr}<span style="opacity:0.7; font-size:0.7em; text-transform:uppercase; display:block; margin-top:10px;">Next: ${nextEvent.label}</span>`;
    }
    // 케이스 4: 아무 일정도 없는 경우
    else {
        countdownEl.innerHTML = '<span style="opacity:0.5; font-size:0.9rem; text-transform:uppercase; letter-spacing: 2px;">대기 중인 일정이 없습니다.</span>';
    }
    
    updateTimetableUI(currentTimestamp, nextEvent, now, currentEvent);
}

function renderTimetable() {
    const listEl = document.getElementById('timetable-list');
    listEl.innerHTML = '';
    
    const grouped = {};
    const dayOrderList = [];
    
    timetable.forEach((event) => {
        // 날짜가 있으면 "Wednesday (15 July 2026)" 형태로 표시
        const groupKey = event.dateStr ? `${event.day} (${event.dateStr})` : event.day;
        if (!grouped[groupKey]) {
            grouped[groupKey] = [];
            dayOrderList.push(groupKey);
        }
        grouped[groupKey].push(event);
    });
    
    dayOrderList.forEach(groupKey => {
        grouped[groupKey].sort((a, b) => a.time.localeCompare(b.time));
        
        const header = document.createElement('li');
        header.className = 'day-header';
        header.textContent = groupKey;
        listEl.appendChild(header);
        
        grouped[groupKey].forEach((event) => {
            const li = document.createElement('li');
            li.className = 'event-item';
            
            const timeDiv = document.createElement('div');
            timeDiv.className = 'time';
            timeDiv.textContent = event.endTime ? `${event.time} - ${event.endTime}` : event.time;
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'label';
            labelDiv.textContent = event.label;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.title = '이 일정 삭제';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                // 객체 자체 비교로 정확하게 필터링
                timetable = timetable.filter(ev => ev !== event);
                // 삭제 후 로컬 스토리지 업데이트
                localStorage.setItem('savedTimetable', JSON.stringify(timetable));
                renderTimetable();
                updateClock();
            };
            
            li.appendChild(timeDiv);
            li.appendChild(labelDiv);
            li.appendChild(deleteBtn);
            
            li.dataset.timestamp = event.timestamp || '';
            li.dataset.time = event.time;
            li.dataset.day = event.day;
            listEl.appendChild(li);
        });
    });
}

let lastScrolledEvent = null;

function updateTimetableUI(currentTimestamp, nextEvent, now, currentEvent) {
    const listItems = document.querySelectorAll('#timetable-list li.event-item');
    listItems.forEach(li => {
        let evTs = parseInt(li.dataset.timestamp);
        
        // timestamp가 없는 경우의 폴백 계산
        if (!evTs) {
            const todayStr = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
            if (li.dataset.day === todayStr || li.dataset.day === 'Today') {
                const [h, m] = li.dataset.time.split(':').map(Number);
                evTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
            }
        }
        
        li.classList.remove('past', 'next', 'ongoing');
        
        if (evTs) {
            let isOngoing = false;
            if (currentEvent) {
                const isMatchingTs = evTs === currentEvent.timestamp || evTs === currentEvent.fallbackTs;
                if (isMatchingTs && li.dataset.time === currentEvent.time) {
                    isOngoing = true;
                }
            }

            if (isOngoing) {
                li.classList.add('ongoing');
                
                // 진행 중인 이벤트가 있으면 최우선으로 스크롤 타겟팅
                if (settings.autoScroll && lastScrolledEvent !== li) {
                    lastScrolledEvent = li;
                    setTimeout(() => {
                        li.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            } else if (evTs <= currentTimestamp) {
                li.classList.add('past');
            }
            
            // nextEvent와 완전히 일치하는 요소 하이라이트 및 자동 스크롤 (진행 중인 이벤트가 없을 때만 스크롤)
            if (nextEvent && (evTs === nextEvent.timestamp || evTs === nextEvent.fallbackTs)) {
                if (li.dataset.time === nextEvent.time) {
                    li.classList.add('next');
                    
                    if (settings.autoScroll && !currentEvent && lastScrolledEvent !== li) {
                        lastScrolledEvent = li;
                        setTimeout(() => {
                            li.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                    }
                }
            }
        }
    });
}

function setupDropZone() {
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
        // 모바일인 경우 업로드 안내 텍스트 변경
        const dropZoneText = document.getElementById('drop-zone-text');
        if (dropZoneText) {
            dropZoneText.style.display = 'none';
        }
        return; // 모바일에서는 파일 업로드 기능 비활성화
    }

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                if (file.type === 'application/pdf') {
                    parsePDF(file);
                } else {
                    alert('PDF 파일만 지원합니다.');
                }
            }
        });
    }

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type === 'application/pdf') {
                parsePDF(file);
            } else {
                alert('PDF 파일만 지원합니다.');
            }
        }
    });
}

function processParsedText(fullText) {
    fullText = fullText.replace(/['"]/g, "'");
    fullText = fullText.replace(/[ \t]+/g, ' '); // \n은 살려두고 연속된 공백만 하나로 축소

    const daysToNormalize = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    daysToNormalize.forEach(day => {
        const spacedDayRegex = new RegExp(day.split('').join('\\s*'), 'gi');
        fullText = fullText.replace(spacedDayRegex, day);
    });

    fullText = fullText.replace(/(\d{1,2})\s*(\d{2})\s*:\s*(\d{2})\s*(\d{2})/g, '$1$2:$3$4');
    fullText = fullText.replace(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/g, '$1-$2');

    const dateDayRegexEn = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/gi;
    const dateDayRegexKo = /(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*\((월|화|수|목|금|토|일)\)/g;
    const fallbackDayRegex = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\(월\)|\(화\)|\(수\)|\(목\)|\(금\)|\(토\)|\(일\))/gi;

    let parts = [];
    let hasDates = false;
    const dateMatches = [];
    
    let matchEn;
    while ((matchEn = dateDayRegexEn.exec(fullText)) !== null) {
        dateMatches.push({
            index: matchEn.index,
            length: matchEn[0].length,
            day: matchEn[1],
            dateStr: `${matchEn[2]} ${matchEn[3]} ${matchEn[4]}`
        });
    }
    
    let matchKo;
    while ((matchKo = dateDayRegexKo.exec(fullText)) !== null) {
        const currentYear = new Date().getFullYear();
        const dayMap = { '월': 'Monday', '화': 'Tuesday', '수': 'Wednesday', '목': 'Thursday', '금': 'Friday', '토': 'Saturday', '일': 'Sunday' };
        dateMatches.push({
            index: matchKo.index,
            length: matchKo[0].length,
            day: dayMap[matchKo[3]] || matchKo[3],
            dateStr: `${currentYear}-${matchKo[1].padStart(2, '0')}-${matchKo[2].padStart(2, '0')}`
        });
    }

    dateMatches.sort((a, b) => a.index - b.index);

    let lastIdx = 0;
    if (dateMatches.length > 0) {
        hasDates = true;
        for (const m of dateMatches) {
            parts.push({ text: fullText.substring(lastIdx, m.index), isBlock: false });
            parts.push({ day: m.day, dateStr: m.dateStr, isBlock: true });
            lastIdx = m.index + m.length;
        }
        parts.push({ text: fullText.substring(lastIdx), isBlock: false });
    }

    if (!hasDates) {
        lastIdx = 0;
        let matchDay;
        while ((matchDay = fallbackDayRegex.exec(fullText)) !== null) {
            let dayName = matchDay[1];
            if (dayName.startsWith('(')) {
                const d = dayName.charAt(1);
                const dayMap = { '월': 'Monday', '화': 'Tuesday', '수': 'Wednesday', '목': 'Thursday', '금': 'Friday', '토': 'Saturday', '일': 'Sunday' };
                dayName = dayMap[d] || dayName;
            }
            parts.push({ text: fullText.substring(lastIdx, matchDay.index), isBlock: false });
            parts.push({ day: dayName, dateStr: '', isBlock: true });
            lastIdx = fallbackDayRegex.lastIndex;
        }
        parts.push({ text: fullText.substring(lastIdx), isBlock: false });
    }

    const newTimetable = [];
    let currentDayObj = { day: '일정', dateStr: '', isBlock: true };

    const eventRegex = /([0-2]?[0-9]:[0-5][0-9])(?:-([0-2]?[0-9]:[0-5][0-9]))?\s+((?:(?!(?:[0-2]?[0-9]:[0-5][0-9]|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\([월화수목금토일]\)))[\s\S])+)/gi;

    for (const p of parts) {
        if (p.isBlock) {
            currentDayObj = p;
        } else {
            let evMatch;
            while ((evMatch = eventRegex.exec(p.text)) !== null) {
                let time = evMatch[1];
                if (time.length === 4) time = '0' + time;
                
                let endTime = evMatch[2];
                if (endTime && endTime.length === 4) endTime = '0' + endTime;
                
                let rawLabel = evMatch[3].trim();
                let labelLines = rawLabel.split('\n');
                let cleanLabel = labelLines[0].trim();
                
                for (let i = 1; i < labelLines.length; i++) {
                    let l = labelLines[i].trim();
                    if (/^[ㆍ\-*\[\(<※]/.test(l) && !l.startsWith('※')) {
                        cleanLabel += ' ' + l;
                    } else {
                        break;
                    }
                }
                
                let label = cleanLabel;
                
                if (label.length > 2) {
                    let ts = 0;
                    if (currentDayObj.dateStr) {
                        let dateTimeStr = `${currentDayObj.dateStr} ${time}`;
                        if (currentDayObj.dateStr.includes('-')) {
                            dateTimeStr = `${currentDayObj.dateStr}T${time}:00`;
                        }
                        ts = new Date(dateTimeStr).getTime();
                    }
                    
                    let displayDay = currentDayObj.day;
                    if (/^[a-zA-Z]+$/.test(displayDay)) {
                        displayDay = displayDay.charAt(0).toUpperCase() + displayDay.slice(1).toLowerCase();
                    }
                    
                    newTimetable.push({
                        day: displayDay,
                        dateStr: currentDayObj.dateStr,
                        time,
                        endTime: endTime || '',
                        label,
                        timestamp: ts
                    });
                }
            }
        }
    }
    return newTimetable;
}

function updateTimetableData(newTimetable, successMessage) {
    const dropZoneText = document.getElementById('drop-zone-text');
    if (newTimetable && newTimetable.length > 0) {
        timetable = newTimetable;
        localStorage.setItem('savedTimetable', JSON.stringify(timetable));
        renderTimetable();
        updateClock();
        if (dropZoneText) {
            dropZoneText.innerHTML = successMessage + '<br>시간표 업데이트 및 저장 완료';
        }
    } else {
        if (dropZoneText) {
            dropZoneText.innerHTML = '일정을 찾지 못했습니다. 형식을 확인해 주세요.';
        }
    }
}

async function parsePDF(file) {
    const dropZoneText = document.getElementById('drop-zone-text');
    if (dropZoneText) dropZoneText.textContent = 'PDF 분석 중...';
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            const items = textContent.items.map(item => ({
                text: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width
            }));

            const lines = [];
            items.forEach(item => {
                let foundLine = lines.find(line => Math.abs(line.y - item.y) < 5);
                if (foundLine) {
                    foundLine.items.push(item);
                } else {
                    lines.push({ y: item.y, items: [item] });
                }
            });

            lines.sort((a, b) => b.y - a.y);

            let pageText = '';
            lines.forEach(line => {
                line.items.sort((a, b) => a.x - b.x);
                
                let lineText = '';
                let lastX = -1;
                let lastWidth = -1;
                
                line.items.forEach(item => {
                    if (lastX !== -1 && (item.x - (lastX + lastWidth)) > 5) {
                        lineText += ' ';
                    }
                    lineText += item.text;
                    lastX = item.x;
                    lastWidth = item.width;
                });
                
                pageText += lineText + '\n';
            });
            
            fullText += pageText + '\n\n';
        }

        const newTimetable = processParsedText(fullText);
        updateTimetableData(newTimetable, 'PDF 파일에서 일정을 불러왔습니다.');
    } catch (err) {
        console.error('PDF 파싱 에러:', err);
        if (dropZoneText) dropZoneText.textContent = 'PDF 분석 중 오류가 발생했습니다.';
    }
}

// Service Worker Registration for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered successfully:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

function loadSettings() {
    const saved = localStorage.getItem('savedSettings');
    if (saved) {
        try {
            settings = { ...defaultSettings, ...JSON.parse(saved) };
        } catch (e) {
            console.error('설정 로드 오류:', e);
        }
    }
}

function saveSettings() {
    localStorage.setItem('savedSettings', JSON.stringify(settings));
}

function applySettings() {
    const root = document.documentElement;
    root.style.setProperty('--bg-color', settings.bgColor);
    root.style.setProperty('--text-main', settings.textColor);
    root.style.setProperty('--accent', settings.accentColor);
    root.style.setProperty('--danger', settings.dangerColor);
    
    root.style.setProperty('--clock-size-val', settings.clockSize);
    root.style.setProperty('--clock-size', settings.clockSize + 'vw');
    root.style.setProperty('--timetable-size-multiplier', settings.timetableSize);
    
    const timetableList = document.getElementById('timetable-list');
    if (timetableList) {
        if (settings.showDeleteBtn) {
            timetableList.classList.remove('hide-delete-btn');
        } else {
            timetableList.classList.add('hide-delete-btn');
        }
    }
    
    syncSettingsUI();
}

function syncSettingsUI() {
    const bgColorInput = document.getElementById('setting-bgColor');
    const textColorInput = document.getElementById('setting-textColor');
    const accentColorInput = document.getElementById('setting-accentColor');
    const dangerColorInput = document.getElementById('setting-dangerColor');
    const clock24hInput = document.getElementById('setting-clock24h');
    const showSecondsInput = document.getElementById('setting-showSeconds');
    const clockSizeInput = document.getElementById('setting-clockSize');
    const showDeleteBtnInput = document.getElementById('setting-showDeleteBtn');
    const autoScrollInput = document.getElementById('setting-autoScroll');
    const timetableSizeInput = document.getElementById('setting-timetableSize');
    
    if (bgColorInput) bgColorInput.value = settings.bgColor;
    if (textColorInput) textColorInput.value = settings.textColor;
    if (accentColorInput) accentColorInput.value = settings.accentColor;
    if (dangerColorInput) dangerColorInput.value = settings.dangerColor;
    
    if (clock24hInput) clock24hInput.checked = settings.clock24h;
    if (showSecondsInput) showSecondsInput.checked = settings.showSeconds;
    if (clockSizeInput) {
        clockSizeInput.value = settings.clockSize;
        const valClockSize = document.getElementById('val-clockSize');
        if (valClockSize) valClockSize.textContent = settings.clockSize.toFixed(1) + 'vw';
    }
    
    if (showDeleteBtnInput) showDeleteBtnInput.checked = settings.showDeleteBtn;
    if (autoScrollInput) autoScrollInput.checked = settings.autoScroll;
    if (timetableSizeInput) {
        timetableSizeInput.value = settings.timetableSize;
        const valTimetableSize = document.getElementById('val-timetableSize');
        if (valTimetableSize) valTimetableSize.textContent = settings.timetableSize.toFixed(2) + 'x';
    }
}

function initSettingsUI() {
    const toggleBtn = document.getElementById('settings-toggle');
    const closeBtn = document.getElementById('settings-close');
    const panel = document.getElementById('settings-panel');
    
    if (toggleBtn && panel) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('open');
        });
    }
    
    if (closeBtn && panel) {
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('open');
        });
    }
    
    document.addEventListener('click', (e) => {
        if (panel && panel.classList.contains('open')) {
            if (!panel.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
                panel.classList.remove('open');
            }
        }
    });
    
    const bindings = [
        { id: 'setting-bgColor', key: 'bgColor', event: 'input' },
        { id: 'setting-textColor', key: 'textColor', event: 'input' },
        { id: 'setting-accentColor', key: 'accentColor', event: 'input' },
        { id: 'setting-dangerColor', key: 'dangerColor', event: 'input' },
        { id: 'setting-clock24h', key: 'clock24h', type: 'checkbox', event: 'change' },
        { id: 'setting-showSeconds', key: 'showSeconds', type: 'checkbox', event: 'change' },
        { id: 'setting-clockSize', key: 'clockSize', type: 'float', event: 'input' },
        { id: 'setting-showDeleteBtn', key: 'showDeleteBtn', type: 'checkbox', event: 'change' },
        { id: 'setting-autoScroll', key: 'autoScroll', type: 'checkbox', event: 'change' },
        { id: 'setting-timetableSize', key: 'timetableSize', type: 'float', event: 'input' }
    ];
    
    bindings.forEach(binding => {
        const el = document.getElementById(binding.id);
        if (el) {
            el.addEventListener(binding.event, (e) => {
                let val;
                if (binding.type === 'checkbox') {
                    val = e.target.checked;
                } else if (binding.type === 'float') {
                    val = parseFloat(e.target.value);
                } else {
                    val = e.target.value;
                }
                
                settings[binding.key] = val;
                saveSettings();
                applySettings();
            });
        }
    });
    
    const btnResetSettings = document.getElementById('btn-reset-settings');
    if (btnResetSettings) {
        btnResetSettings.addEventListener('click', () => {
            if (confirm('모든 설정을 초기화하시겠습니까?')) {
                settings = { ...defaultSettings };
                saveSettings();
                applySettings();
            }
        });
    }
    
    const btnResetTimetable = document.getElementById('btn-reset-timetable');
    if (btnResetTimetable) {
        btnResetTimetable.addEventListener('click', () => {
            if (confirm('저장된 시간표 데이터를 삭제하시겠습니까?')) {
                timetable = [];
                localStorage.removeItem('savedTimetable');
                renderTimetable();
                updateClock();
                
                const dropZoneText = document.getElementById('drop-zone-text');
                if (dropZoneText) {
                    dropZoneText.innerHTML = 'Drag & Drop PDF Here';
                }
                alert('시간표 데이터가 삭제되었습니다.');
            }
        });
    }
}

// Wallpaper Engine Property Integration
window.wallpaperPropertyListener = {
    applyUserProperties: function(properties) {
        if (!properties) return;
        
        if (properties.clock24h) {
            settings.clock24h = properties.clock24h.value;
        }
        if (properties.showSeconds) {
            settings.showSeconds = properties.showSeconds.value;
        }
        if (properties.accentColor) {
            settings.accentColor = convertWEColor(properties.accentColor.value);
        }
        if (properties.dangerColor) {
            settings.dangerColor = convertWEColor(properties.dangerColor.value);
        }
        if (properties.bgColor) {
            settings.bgColor = convertWEColor(properties.bgColor.value);
        }
        if (properties.textColor) {
            settings.textColor = convertWEColor(properties.textColor.value);
        }
        if (properties.clockSize) {
            settings.clockSize = properties.clockSize.value;
        }
        if (properties.timetableSize) {
            settings.timetableSize = properties.timetableSize.value;
        }
        if (properties.showDeleteBtn) {
            settings.showDeleteBtn = properties.showDeleteBtn.value;
        }
        if (properties.autoScroll) {
            settings.autoScroll = properties.autoScroll.value;
        }
        
        saveSettings();
        applySettings();
    }
};

function convertWEColor(weColor) {
    if (typeof weColor === 'string') {
        const parts = weColor.split(' ');
        if (parts.length === 3) {
            const r = Math.round(parseFloat(parts[0]) * 255);
            const g = Math.round(parseFloat(parts[1]) * 255);
            const b = Math.round(parseFloat(parts[2]) * 255);
            return rgbToHex(r, g, b);
        }
    }
    return weColor;
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

window.onload = init;
