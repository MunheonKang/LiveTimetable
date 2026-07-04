const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function extractText(filePath) {
    const data = new Uint8Array(fs.readFileSync(filePath));
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
        fullText += pageText + '\n\n';
    }
    fs.writeFileSync('new_pdf_output.txt', fullText);
    console.log("Done");
}

extractText('[운영팀 전용] F06-26 작업 스케줄러 (태백).pdf').catch(console.error);
