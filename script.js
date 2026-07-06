// 초기 타임테이블 데이터 (비어 있음)
let timetable = [];

let lastPdfVersion = '';
async function checkLocalPDF() {
    try {
        // 캐시를 무시하고 서버의 최신 상태(헤더)만 먼저 확인
        const headResponse = await fetch('schedule.pdf?t=' + Date.now(), { method: 'HEAD' });
        if (headResponse.ok) {
            const currentVersion = headResponse.headers.get('ETag') || headResponse.headers.get('Last-Modified');
            
            // 파일이 처음 로드되거나, 서버에서 파일이 변경된 경우에만 다운로드 및 파싱
            if (currentVersion && currentVersion !== lastPdfVersion) {
                lastPdfVersion = currentVersion;
                const response = await fetch('schedule.pdf?t=' + Date.now());
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                    blob.name = 'schedule.pdf';
                    parsePDF(blob);
                }
            }
        }
    } catch (e) {
        console.log("웹 서버에서 schedule.pdf를 찾을 수 없거나 접근할 수 없습니다.");
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
                dropZoneText.innerHTML = '저장된 시간표를 불러왔습니다.<br>새 PDF를 드롭하거나 터치(클릭)하여 변경할 수 있습니다.';
            }
        } catch (e) {
            console.error('저장된 시간표 로드 중 에러:', e);
        }
    }

    updateClock();
    setInterval(updateClock, 1000);
    
    // 웹 환경인 경우 처음에 읽어오고, 1분마다 서버의 파일 변경 여부를 감시 (자동 갱신)
    checkLocalPDF();
    setInterval(checkLocalPDF, 60000);
    
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
    
    let nextEvent = null;
    let nextEventDiff = Infinity;

    for (const event of timetable) {
        if (event.timestamp) {
            // 정확한 날짜가 파싱된 경우 절대 시간 비교
            const diffSeconds = Math.floor((event.timestamp - currentTimestamp) / 1000);
            if (diffSeconds > 0 && diffSeconds < nextEventDiff) {
                nextEvent = event;
                nextEventDiff = diffSeconds;
            }
        } else {
            // 날짜가 없는 경우 (오늘 날짜라고 가정하고 임시 비교)
            const todayStr = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
            if (event.day === todayStr || event.day === 'Today') {
                const [h, m] = event.time.split(':').map(Number);
                const evTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
                const diffSeconds = Math.floor((evTs - currentTimestamp) / 1000);
                if (diffSeconds > 0 && diffSeconds < nextEventDiff) {
                    nextEvent = event;
                    nextEventDiff = diffSeconds;
                    nextEvent.fallbackTs = evTs; // 임시 타임스탬프 저장
                }
            }
        }
    }

    const countdownEl = document.getElementById('countdown');
    if (nextEvent) {
        const d = Math.floor(nextEventDiff / (24 * 3600));
        const h = Math.floor((nextEventDiff % (24 * 3600)) / 3600);
        const m = Math.floor((nextEventDiff % 3600) / 60);
        const s = nextEventDiff % 60;
        
        let timeStr = '';
        if (d > 0) timeStr += `${d}d `;
        if (h > 0 || d > 0) timeStr += `${h}h `;
        timeStr += `${m}m ${s}s`;
        
        countdownEl.innerHTML = `-${timeStr}<span style="opacity:0.7; font-size:0.7em; text-transform:uppercase; display:block; margin-top:10px;">Next: ${nextEvent.label}</span>`;
    } else {
        countdownEl.innerHTML = ''; // 일정이 없으면 텍스트도 완전히 지움
    }
    
    updateTimetableUI(currentTimestamp, nextEvent, now);
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

function updateTimetableUI(currentTimestamp, nextEvent, now) {
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
        
        li.classList.remove('past', 'next');
        
        if (evTs) {
            if (evTs <= currentTimestamp) {
                li.classList.add('past');
            }
            // nextEvent와 완전히 일치하는 요소 하이라이트 및 자동 스크롤
            if (nextEvent && (evTs === nextEvent.timestamp || evTs === nextEvent.fallbackTs)) {
                // 정확도를 높이기 위해 시간 텍스트도 확인
                if (li.dataset.time === nextEvent.time) {
                    li.classList.add('next');
                    
                    // 월페이퍼 엔진 환경을 위해 현재 진행 중인 이벤트가 항상 화면 중앙에 오도록 자동 스크롤
                    if (lastScrolledEvent !== li) {
                        lastScrolledEvent = li;
                        // 약간의 딜레이를 주어 렌더링 후 스크롤되도록 함
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

    dropZone.addEventListener('click', (e) => {
        // 우측 시간표나 삭제 버튼 등 인터랙티브 요소 클릭 시 작동 방지
        const rightContent = document.querySelector('.right-content');
        if (rightContent && rightContent.contains(e.target)) {
            return;
        }
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return;
        }
        if (fileInput) {
            fileInput.click();
        }
    });

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

async function parsePDF(file) {
    const dropZoneText = document.getElementById('drop-zone-text');
    dropZoneText.textContent = 'PDF 분석 중...';
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            // 2D 좌표 기반의 정교한 텍스트 추출 (X, Y 정렬 알고리즘 도입)
            const items = textContent.items.map(item => ({
                text: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width
            }));

            // Y 좌표를 기준으로 오차범위(5px) 내에 있는 텍스트들을 같은 줄(Line)로 그룹화
            const lines = [];
            items.forEach(item => {
                let foundLine = lines.find(line => Math.abs(line.y - item.y) < 5);
                if (foundLine) {
                    foundLine.items.push(item);
                } else {
                    lines.push({ y: item.y, items: [item] });
                }
            });

            // 위에서부터 아래로 읽도록 Y 좌표 내림차순 정렬 (PDF는 0이 화면 하단)
            lines.sort((a, b) => b.y - a.y);

            let pageText = '';
            lines.forEach(line => {
                // 같은 줄 안에서는 왼쪽에서 오른쪽으로 읽도록 X 좌표 오름차순 정렬
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
        // 요일이 명시되지 않은 문서나 첫 요일 이전의 이벤트를 담기 위한 기본값
        let currentDayObj = { day: '일정', dateStr: '', isBlock: true };

        // 09:00 뿐만 아니라 9:00 형식도 지원. 종료 시간도 캡처 그룹으로 추가.
        const eventRegex = /([0-2]?[0-9]:[0-5][0-9])(?:-([0-2]?[0-9]:[0-5][0-9]))?\s+((?:(?!(?:[0-2]?[0-9]:[0-5][0-9]|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\([월화수목금토일]\)))[\s\S])+)/gi;

        for (const p of parts) {
            if (p.isBlock) {
                currentDayObj = p;
            } else {
                let evMatch;
                while ((evMatch = eventRegex.exec(p.text)) !== null) {
                    let time = evMatch[1];
                    // 9:00 인 경우 09:00 으로 패딩
                    if (time.length === 4) time = '0' + time;
                    
                    let endTime = evMatch[2];
                    if (endTime && endTime.length === 4) endTime = '0' + endTime;
                    
                    let rawLabel = evMatch[3].trim();
                    
                    // 첫 줄(시간과 같은 줄에 있는 텍스트)은 무조건 일정 제목으로 사용
                    let labelLines = rawLabel.split('\n');
                    let cleanLabel = labelLines[0].trim();
                    
                    // 두 번째 줄부터는 부연 설명(글머리 기호나 괄호로 시작)일 경우에만 이어붙임
                    for (let i = 1; i < labelLines.length; i++) {
                        let l = labelLines[i].trim();
                        // 일정의 부연 설명으로 인정할 시작 문자들 (ㆍ, -, *, [, (, < 등)
                        if (/^[ㆍ\-*\[\(<※]/.test(l) && !l.startsWith('※')) {
                            cleanLabel += ' ' + l;
                        } else {
                            // 부연 설명 기호로 시작하지 않으면 그 즉시 캡처 중단 (하단 쓰레기 텍스트 방어)
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
                            endTime: endTime || '', // 종료 시간이 없으면 빈 문자열
                            label,
                            timestamp: ts
                        });
                    }
                }
            }
        }
        
        if (newTimetable.length > 0) {
            timetable = newTimetable;
            // 새롭게 추가된 타임테이블을 로컬 스토리지에 저장 (새로고침 유지용)
            localStorage.setItem('savedTimetable', JSON.stringify(timetable));
            renderTimetable();
            updateClock();
            dropZoneText.innerHTML = '시간표 업데이트 및 저장 완료 (다른 PDF 드롭/터치 가능)';
        } else {
            dropZoneText.innerHTML = 'PDF에서 일정을 찾지 못했습니다. 다시 시도해 주세요.';
        }
    } catch (err) {
        console.error('PDF 파싱 에러:', err);
        dropZoneText.textContent = 'PDF 분석 중 오류가 발생했습니다.';
    }
}

window.onload = init;
