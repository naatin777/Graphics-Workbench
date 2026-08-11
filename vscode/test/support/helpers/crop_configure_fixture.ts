export const cropConfigureFixture = {
  fileName: 'multilingual-text.pdf',
  expectedCroppedPageFileName: 'a a-1-crop.pdf',
  complexUnicodeFileName: '　日本語 English 한국어 中文 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹 ＡＢＣ１２３①.pdf',
  cropBox: {
    left: 20,
    bottom: 30,
    right: 200,
    top: 280,
  },
  fullPageBox: {
    left: 0,
    bottom: 0,
    right: 240,
    top: 320,
  },
};
