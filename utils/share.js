// 保留文本换行工具；分享页仅展示卡片，不生成导出图片。
function wrap(ctx, text, width) {
  const lines = [];
  String(text)
    .split('\n')
    .forEach((paragraph) => {
      let line = '';
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > width) {
          lines.push(line);
          line = char;
        } else line += char;
      }
      lines.push(line);
    });
  return lines;
}
module.exports = { wrap };
