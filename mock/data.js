// 虚构示例，与设计原型一致。历史为独立样例记录，真实模式只读取 records。
const students = [
  {
    id: 'a',
    name: '小禾',
    grade_class: '四年级',
    school: '青溪小学',
    psychology: 58,
    aesthetic: 82,
    finance: 65,
    behavior: 78,
    period: '2026-10',
    last: '10.10',
    volunteer_id: 'v1',
    volunteer_name: '林知夏'
  },
  {
    id: 'b',
    name: '阿远',
    grade_class: '五年级',
    school: '青溪小学',
    psychology: 84,
    aesthetic: 86,
    finance: 80,
    behavior: 82,
    period: '2026-10',
    last: '10.09',
    volunteer_id: 'v1',
    volunteer_name: '林知夏'
  },
  {
    id: 'c',
    name: '小满',
    grade_class: '三年级',
    school: '山桥小学',
    psychology: 72,
    aesthetic: 78,
    finance: 68,
    behavior: 74,
    period: '2026-10',
    last: '10.08',
    volunteer_id: 'v2',
    volunteer_name: '周青'
  },
  {
    id: 'd',
    name: '小川',
    grade_class: '四年级',
    school: '山桥小学',
    psychology: 38,
    aesthetic: 64,
    finance: 55,
    behavior: 63,
    period: '2026-10',
    last: '10.06',
    volunteer_id: 'v3',
    volunteer_name: '陈默'
  },
  {
    id: 'e',
    name: '小雨',
    grade_class: '二年级',
    school: '青溪小学',
    psychology: 80,
    aesthetic: 84,
    finance: 76,
    behavior: 81,
    period: '2026-10',
    last: '—',
    volunteer_id: null,
    volunteer_name: null
  }
];
const records = {
  a: [
    [50, 74, 57, 70],
    [52, 76, 59, 72],
    [59, 78, 61, 74],
    [58, 82, 65, 78]
  ],
  b: [
    [76, 78, 72, 74],
    [78, 80, 74, 76],
    [85, 82, 76, 78],
    [84, 86, 80, 82]
  ],
  c: [
    [64, 70, 60, 66],
    [66, 72, 62, 68],
    [73, 74, 64, 70],
    [72, 78, 68, 74]
  ],
  d: [
    [30, 56, 47, 55],
    [32, 58, 49, 57],
    [39, 60, 51, 59],
    [38, 64, 55, 63]
  ],
  e: [
    [72, 76, 68, 73],
    [74, 78, 70, 75],
    [81, 80, 72, 77],
    [80, 84, 76, 81]
  ]
};
const poems = [
  {
    id: 'p1',
    student_id: 'a',
    student_name: '小禾',
    title: '把小小的光，种进秋天',
    period: '2026-10',
    created_at: '2026-10-11',
    cover_url: '',
    content:
      '你把落叶夹进书页，\n把秋天留在手掌里。\n\n那句轻轻说出的“我来试试”，\n像一颗种子，探出了头。\n\n不必急着长成大树，\n今天的你，已经向着光。'
  },
  {
    id: 'p2',
    student_id: 'b',
    student_name: '阿远',
    title: '风经过，你有自己的方向',
    period: '2026-10',
    created_at: '2026-10-10',
    cover_url: '',
    content:
      '你将纸飞机轻轻放飞，\n也把愿望写进风里。\n\n弯下腰，拾起一片叶子，\n抬起头，又看见一片天空。\n\n每一步都有自己的方向，\n每一次尝试，都在长大。'
  }
];
const logs = [
  {
    id: 'l1',
    student_id: 'a',
    student_name: '小禾',
    volunteer_name: '林知夏',
    type: '活动',
    created_at: '2026-10-10',
    content:
      '一起做了秋叶拼贴。小禾开始时有些犹豫，后来主动选了三片叶子，说“我来试试”。结束时，他愿意把作品讲给我听。',
    images: [],
    illustration: true
  },
  {
    id: 'l2',
    student_id: 'b',
    student_name: '阿远',
    volunteer_name: '林知夏',
    type: '通话',
    created_at: '2026-10-09',
    content: '聊了这周的校园生活。阿远说自己主动帮同学整理图书，我们约定下次一起读他选的故事。',
    images: []
  },
  {
    id: 'l3',
    student_id: 'a',
    student_name: '小禾',
    volunteer_name: '林知夏',
    type: '探访',
    created_at: '2026-09-27',
    content: '一起读了绘本。小禾更愿意用画画表达想法，下次带上彩纸，给他更多选择。',
    images: []
  }
];
const volunteers = [
  { id: 'v1', name: '林知夏', org: '青溪志愿服务队', relation_count: 2, status: 'active' },
  { id: 'v2', name: '周青', org: '青溪志愿服务队', relation_count: 1, status: 'active' },
  { id: 'v3', name: '陈默', org: '山桥公益小队', relation_count: 1, status: 'active' }
];
module.exports = { students, records, poems, logs, volunteers };
