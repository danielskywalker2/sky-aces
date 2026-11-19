// 스토리 이미지 에셋 목록 — 경로는 여기서만 관리한다. 파일이 없어도 게임은 픽셀아트 대체 화면으로 동작한다.
window.IRON_ASSETS = {
  backgrounds: {
    stage1: 'assets/story/backgrounds/stage1/main.jpg',   // 태평양 상공 전투
    stage2: 'assets/story/backgrounds/stage2/main.jpg',   // 사막 비밀 군사기지
    stage3: 'assets/story/backgrounds/stage3/main.jpg',   // 북극 비밀 연구시설
    stage4: 'assets/story/backgrounds/stage4/main.jpg',   // 대서양 대규모 공중전
    stage5: 'assets/story/backgrounds/stage5/main.jpg',   // 최종 공중 요새
  },
  endings: {
    destruction: 'assets/story/endings/destruction.jpg',  // 최종 병기 파괴
    sunrise: 'assets/story/endings/sunrise.jpg',          // 일출 속 귀환
  },
  characters: {
    commander: 'assets/story/characters/commander/portrait.jpg',
    falcon1: 'assets/story/characters/falcon1/portrait.jpg',
    wingman: 'assets/story/characters/wingman/portrait.jpg',
    intel: 'assets/story/characters/intel/portrait.jpg',
    enemy: 'assets/story/characters/enemy/portrait.jpg',
    traitor: null, // 초상화 없음 → 픽셀 아바타
  },
};
