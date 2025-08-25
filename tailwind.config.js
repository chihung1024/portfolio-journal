/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './js/**/*.{js,ts,jsx,tsx}', // 掃描 js 資料夾下所有 .js 檔案
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
