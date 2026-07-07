// 초기 타임테이블 데이터 (비어 있음)
let timetable = [];

let lastPdfVersion = '';
let lastTxtVersion = '';
let lastLoadedSource = ''; // 'pdf' or 'txt'

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
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('clock').textContent = `${hours}:${minutes}:${seconds}`;

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
    let htmlContent = '';

    // 진행 중인 일정이 있는 경우
    if (currentEvent && currentEventEndDiff !== Infinity) {
        const h = Math.floor(currentEventEndDiff / 3600);
        const m = Math.floor((currentEventEndDiff % 3600) / 60);
        const s = currentEventEndDiff % 60;
        
        let timeStr = '';
        if (h > 0) timeStr += `${h}h `;
        timeStr += `${m}m ${s}s`;
        
        htmlContent += `<div class="current-event-countdown" style="margin-bottom: 25px;">
            <span style="opacity:0.6; font-size:0.65em; text-transform:uppercase; display:block; margin-bottom:5px; letter-spacing: 1px;">ONGOING: ${currentEvent.label}</span>
            <span style="font-size:2.2rem; font-weight:600; color:var(--danger); display:block; letter-spacing: -1px;">-${timeStr}</span>
        </div>`;
    }

    // 다음 일정이 있는 경우
    if (nextEvent) {
        const d = Math.floor(nextEventDiff / (24 * 3600));
        const h = Math.floor((nextEventDiff % (24 * 3600)) / 3600);
        const m = Math.floor((nextEventDiff % 3600) / 60);
        const s = nextEventDiff % 60;
        
        let timeStr = '';
        if (d > 0) timeStr += `${d}d `;
        if (h > 0 || d > 0) timeStr += `${h}h `;
        timeStr += `${m}m ${s}s`;
        
        // 진행 중인 일정이 있는 경우 폰트 크기 및 간격을 약간 축소하여 밸런스 유지
        const nextFontSize = currentEvent ? '1.4rem' : '2.2rem';
        const nextLetterSpacing = currentEvent ? '0px' : '-1px';
        const labelSize = currentEvent ? '0.6em' : '0.65em';
        
        htmlContent += `<div class="next-event-countdown">
            <span style="opacity:0.6; font-size:${labelSize}; text-transform:uppercase; display:block; margin-bottom:5px; letter-spacing: 1px;">NEXT: ${nextEvent.label}</span>
            <span style="font-size:${nextFontSize}; font-weight:600; display:block; color:var(--accent); letter-spacing: ${nextLetterSpacing};">-${timeStr}</span>
        </div>`;
    }

    countdownEl.innerHTML = htmlContent;
    
    if (!currentEvent && !nextEvent) {
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
                if (lastScrolledEvent !== li) {
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
                    
                    if (!currentEvent && lastScrolledEvent !== li) {
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

window.onload = init;
