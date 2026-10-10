import { useEffect, useRef } from 'react';
import { useEditor } from './store';

/** 입력칸 하나를 고치는 동안(포커스~블러)은 한 번의 실행취소 단위로 묶는다 */
export function useTxnField() {
  const focused = useRef(false);
  useEffect(
    () => () => {
      if (focused.current) useEditor.getState().endTxn();
    },
    [],
  );
  return {
    onFocus: () => {
      focused.current = true;
      useEditor.getState().beginTxn();
    },
    onBlur: () => {
      focused.current = false;
      useEditor.getState().endTxn();
    },
  };
}
