import { useState } from 'react';
import { publicUrl } from '../publicUrl';

/**
 * 로고 슬롯. public/assets/brand/logo.svg 가 있으면 사용하고,
 * 없으면 임시 모노그램을 보여준다. (최종 로고는 외부 제작 에셋)
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className="brand__mark" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
        M
      </span>
    );
  return <img className="brand__logo" src={publicUrl('assets/brand/logo.svg')} alt="" width={size} height={size} onError={() => setFailed(true)} />;
}
