const text = `16:10 - 16:30 [주행 9] 서킷 주행 9 (20 분) ㆍ[피날레 주행] 최종 예선/결승 형태의 주행 통제
ㆍ체커플래그 발령 및 안전한 피트인 복귀 인도
16:30 ~ 디브리핑 및 철수 ㆍ포뮬러카 상차 및 현장 장비 패킹 철수 작업
※ 주의: 다음 날은 어쩌고 저쩌고...`;

const eventRegex = /([0-2]?[0-9]:[0-5][0-9])(?:-[0-2]?[0-9]:[0-5][0-9])?\s+((?:(?!(?:[0-2]?[0-9]:[0-5][0-9]|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\([월화수목금토일]\)))[\s\S])+)/gi;

let match;
while ((match = eventRegex.exec(text)) !== null) {
    let time = match[1];
    let label = match[2].trim();
    label = label.split(/\n\s*※|\n\s*■|\n\s*시간|\n\s*\n/)[0].trim();
    label = label.replace(/\n/g, ' ');
    console.log(`Time: ${time}`);
    console.log(`Label: ${label}`);
    console.log('---');
}
