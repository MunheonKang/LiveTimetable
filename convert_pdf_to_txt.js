const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Get last commit timestamp for a file
function getGitMtime(filepath) {
    try {
        const stdout = execSync(`git log -1 --format="%ct" -- "${filepath}"`).toString().trim();
        return parseInt(stdout, 10) || 0;
    } catch (e) {
        return 0;
    }
}

async function convert() {
    const pdfPath = path.join(__dirname, 'schedule.pdf');
    const txtPath = path.join(__dirname, 'schedule.txt');

    if (!fs.existsSync(pdfPath)) {
        console.error("schedule.pdf 파일이 존재하지 않습니다.");
        return;
    }

    const pdfMtime = getGitMtime('schedule.pdf');
    const txtMtime = getGitMtime('schedule.txt');

    console.log(`PDF Git Mtime: ${pdfMtime}`);
    console.log(`TXT Git Mtime: ${txtMtime}`);

    if (fs.existsSync(txtPath) && txtMtime >= pdfMtime) {
        const content = fs.readFileSync(txtPath, 'utf8').trim();
        if (content !== '' && content !== '# PLACEHOLDER') {
            console.log("schedule.txt가 schedule.pdf보다 최신이거나 같으므로 변환을 건너뜁니다.");
            return;
        }
    }

    console.log("schedule.pdf가 더 최신이거나 schedule.txt가 없으므로 변환을 시작합니다...");

    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const doc = await pdfjsLib.getDocument(data).promise;
    let fullText = '';
    
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        
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

    fs.writeFileSync(txtPath, fullText, 'utf8');
    console.log(`성공적으로 schedule.pdf를 텍스트로 변환하여 ${txtPath}에 저장했습니다.`);
}

convert().catch(console.error);
