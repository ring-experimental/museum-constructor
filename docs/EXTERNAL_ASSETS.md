# 외부 제작이 필요한 에셋 목록

이 프로토타입은 고품질 2D 에셋 없이도 동작하도록 만들어져 있습니다.
아래 경로에 파일을 **같은 이름으로 넣기만 하면 코드 수정 없이 자동 적용**되고, 파일이 없으면 지금처럼 단색/텍스트 대체 표현으로 동작합니다.

> 3D 소품 모델(벤치, 화분, 조각 좌대, 천장 스포트 조명, 엘리베이터)은 로컬 Blender로 제작이 끝났습니다 → `public/assets/models/*.glb`, 생성 스크립트 `tools/blender/`.

## 우선순위 요약

| 우선 | 에셋 | 경로 | 없을 때 동작 |
|---|---|---|---|
| ★★★ | 샘플 전시 사진 12장 | `public/assets/samples/sample-01.jpg` … `sample-12.jpg` | 그라디언트 임시 이미지 |
| ★★★ | 바닥 PBR 텍스처 4종 | `public/assets/textures/floor_*/` | 단색 바닥 |
| ★★☆ | 벽 플라스터 텍스처 | `public/assets/textures/wall_plaster/` | 단색 벽 |
| ★★☆ | 로고 / 파비콘 | `public/assets/brand/logo.svg`, `favicon.svg` | "M" 모노그램, 파비콘 없음 |
| ★★☆ | 관람 목록 키 비주얼 | `public/assets/brand/hero.jpg` | 텍스트만 있는 히어로 |
| ★☆☆ | 오크 액자 나뭇결 | `public/assets/textures/frame_oak/` | 단색 오크 |
| ★☆☆ | 3D 소품용 텍스처 | (Blender 스크립트 수정 필요) | 단색 PBR 재질 |

---

## 1. 샘플 전시 사진 (첫 실행 시 자동 생성되는 데모 전시용)

- 파일: `public/assets/samples/sample-01.jpg` ~ `sample-12.jpg`
- 형식: JPG, sRGB, 긴 변 2048px, 장당 600KB 이하 권장
- **비율을 지켜 주세요** (액자 크기가 이 비율로 미리 잡혀 있습니다. 다르면 가운데를 잘라 씁니다)

| 파일 | 비율 | 파일 | 비율 |
|---|---|---|---|
| sample-01 | 4:3 가로 | sample-07 | 4:5 세로 |
| sample-02 | 3:4 세로 | sample-08 | 5:4 가로 |
| sample-03 | 1:1 | sample-09 | 3:2 가로 |
| sample-04 | 3:2 가로 | sample-10 | 1:1 |
| sample-05 | 2:3 세로 | sample-11 | 2:3 세로 |
| sample-06 | 16:9 가로 | sample-12 | 4:3 가로 |

- 작품 제목(‘새벽의 수평선’, ‘정적의 방’ …)은 `src/storage/artworkSource.ts` 의 `SAMPLE_TITLES` 에 있습니다. 사진을 교체하면 제목도 함께 맞춰 주세요.
- 공개 데모에 쓸 것이므로 **상업적 사용이 가능한 라이선스**인지 확인이 필요합니다.
- 이미 생성된 샘플 전시는 브라우저에 저장돼 있으므로, 파일을 넣은 뒤 새로고침하면 이미지가 교체되어 보입니다 (데이터 재생성 불필요).

## 2. PBR 텍스처 (바닥 · 벽 · 액자)

공통 규격:
- 폴더마다 3장: `basecolor.jpg`, `normal.jpg`, `roughness.jpg` (normal 맵은 **OpenGL(+Y)** 방식)
- **이음매 없는(seamless) 타일**, 2048×2048 (모바일 고려 시 1024×1024도 가능)
- 한 장이 덮는 실제 크기가 정해져 있으니 그 크기에 맞는 스케일로 제작 (너무 크면 반복 무늬가 보이고, 작으면 뭉개짐)

| 폴더 | 내용 | 한 장 = 실제 크기 | 메모 |
|---|---|---|---|
| `floor_oak/` | 오크 원목 마루 (헤링본 X, 일자 마루) | 2m × 2m | 판재 폭 15~20cm, 결 방향 = 텍스처 가로 |
| `floor_concrete/` | 폴리싱 콘크리트 | 3m × 3m | 은은한 얼룩, 과한 크랙 X |
| `floor_marble/` | 화이트 마블 | 2m × 2m | 연한 회색 결, 줄눈 있는 60cm 타일도 OK |
| `floor_dark/` | 다크 테라조 | 2m × 2m | 어두운 바탕 + 작은 골재 |
| `wall_plaster/` | 벽 플라스터/페인트 질감 | 3m × 3m | **basecolor 는 거의 흰색 무채색**(평균 #F0F0F0 내외)으로. 테마 벽 색과 곱해집니다 |
| `frame_oak/` | 액자용 오크 나뭇결 | 1m × 1m | 결 방향 = 텍스처 가로(u) |

- 바닥 텍스처가 들어가면 재질 색(단색)은 자동으로 흰색으로 바뀌고 텍스처 색이 그대로 쓰입니다.
- 무료 소스 예: ambientCG, Poly Haven (CC0). 받은 뒤 위 이름으로 바꿔 넣으면 됩니다.

## 3. 브랜드 / UI

| 파일 | 규격 | 쓰이는 곳 |
|---|---|---|
| `public/assets/brand/logo.svg` | 정사각 심볼, 28px에서도 식별 가능, 밝은 배경용 | 상단 헤더 좌측 |
| `public/assets/brand/favicon.svg` | 정사각, 16·32px 가독성 | 브라우저 탭 |
| `public/assets/brand/hero.jpg` | 4:3, 1600×1200, 400KB 이하 | 관람 모드 목록 상단 오른쪽 키 비주얼 (있으면 2단 레이아웃으로 바뀜) |

권장 톤: 따뜻한 오프화이트 배경(#F4F2EE), 잉크 블랙(#16161A), 포인트 버밀리언(#FF5A1F). 폰트는 Pretendard(번들 포함, OFL).

선택(향후 서버/공유 기능 시): 공유 미리보기 이미지 `og-image.jpg` 1200×630, `apple-touch-icon.png` 180×180, 빈 목록 일러스트(현재는 아이콘으로 대체).

## 4. (선택) 3D 소품 텍스처

Blender 모델은 현재 단색 PBR 재질이라 가까이서 보면 단조롭습니다. 아래 텍스처가 있으면 `tools/blender/build_props.py` 에서 이미지 텍스처 노드를 연결해 다시 내보낼 수 있습니다 (UV는 대부분 1 UV = 1m 박스 투영으로 이미 펼쳐져 있음).

- 벤치 상판 오크 나뭇결 (`Bench_Wood`, 결 방향 = 벤치 길이)
- 엘리베이터 문 헤어라인 스테인리스 (`Elevator_Steel`, 세로 결)
- 엘리베이터 외장 석재/테라조 (`Elevator_Clad`)
- 화분 잎 알베도+노멀(잎맥) (`Plant_Leaf_A/B`, 잎마다 0..1 UV, 잎자루 v=0 · 끝 v=1)
- 조각 브론즈 파티나/거칠기 변화 (`Sculpture_Bronze`)
