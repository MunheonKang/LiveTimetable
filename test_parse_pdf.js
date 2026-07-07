const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function extract() {
    const data = new Uint8Array(fs.readFileSync('[운영팀 전용] F06-26 작업 스케줄러 (태백).pdf'));
    const doc = await pdfjsLib.getDocument(data).promise;
    let fullText = '';
    
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        
        let pageText = '';
        let lastY = -1;
        let lastX = -1;
        let lastWidth = -1;
        
        textContent.items.forEach(item => {
            if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
                pageText += '\n';
            } else if (lastX !== -1 && (item.transform[4] - (lastX + lastWidth)) > 5) {
                pageText += ' ';
            }
            pageText += item.str;
            lastX = item.transform[4];
            lastY = item.transform[5];
            lastWidth = item.width;
        });
        fullText += pageText + ' ';
    }

    fullText = fullText.replace(/['"]/g, "'");
    fullText = fullText.replace(/[ \t]+/g, ' '); // keep \n

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
        dateMatches.push({ index: matchEn.index, length: matchEn[0].length, day: matchEn[1], dateStr: `${matchEn[2]} ${matchEn[3]} ${matchEn[4]}` });
    }
    
    let matchKo;
    while ((matchKo = dateDayRegexKo.exec(fullText)) !== null) {
        const currentYear = new Date().getFullYear();
        const dayMap = { '월': 'Monday', '화': 'Tuesday', '수': 'Wednesday', '목': 'Thursday', '금': 'Friday', '토': 'Saturday', '일': 'Sunday' };
        dateMatches.push({ index: matchKo.index, length: matchKo[0].length, day: dayMap[matchKo[3]] || matchKo[3], dateStr: `${currentYear}-${matchKo[1].padStart(2, '0')}-${matchKo[2].padStart(2, '0')}` });
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

    // Notice we use [\s\S] instead of . to capture newlines!
    const eventRegex = /([0-2]?[0-9]:[0-5][0-9])(?:-[0-2]?[0-9]:[0-5][0-9])?\s+((?:(?!(?:[0-2]?[0-9]:[0-5][0-9]|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\([월화수목금토일]\)))[\s\S])+)/gi;

    const newTimetable = [];
    let currentDayObj = { day: '일정', dateStr: '', isBlock: true };

    for (const p of parts) {
        if (p.isBlock) {
            currentDayObj = p;
        } else {
            let evMatch;
            const seenTimes = new Set();
            while ((evMatch = eventRegex.exec(p.text)) !== null) {
                let time = evMatch[1];
                if (time.length === 4) time = '0' + time;
                
                let label = evMatch[2].trim();
                
                // CLEAN UP LABEL: Stop at specific boundaries like empty lines, ※, ■, 등
                label = label.split(/\n\s*※|\n\s*■|\n\s*시간|\n\s*\n/)[0].trim();
                
                // Replace internal newlines with space to make it look clean
                label = label.replace(/\n/g, ' ');

                if (label.length > 2 && !seenTimes.has(time)) {
                    console.log(`[${currentDayObj.day}] ${time} -> ${label}`);
                    seenTimes.add(time);
                }
            }
        }
    }
}

extract().catch(console.error);
