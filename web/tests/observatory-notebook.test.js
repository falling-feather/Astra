import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNotebook, addNote, toggleFavorite, readNotebook, writeNotebook, notebookKey } from '../src/observatory/notebook.js';

test('日志去除空白、拒绝空记录，并在刷新后保持真实内容与时间', () => {
  const data = new Map();
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  let book=emptyNotebook();
  assert.throws(()=>addNote(book,'   ','milky-way','2026-09-22T12:00:00Z'),/写下/);
  book=addNote(book,'  今晚海潮像流动的星光。  ','milky-way','2026-09-22T12:00:00Z');
  writeNotebook(storage,'test',book);
  const loaded=readNotebook(storage,'test');
  assert.equal(loaded.issue,null);
  assert.equal(loaded.notebook.notes[0].text,'今晚海潮像流动的星光。');
  assert.equal(loaded.notebook.notes[0].createdAt,'2026-09-22T12:00:00Z');
  assert.equal(emptyNotebook().notes.length,0);
});

test('收藏切换保持唯一，取消收藏只移除目标星域', () => {
  let book=toggleFavorite(emptyNotebook(),'milky-way');
  book=toggleFavorite(book,'blue-cluster');
  assert.deepEqual(book.favorites,['milky-way','blue-cluster']);
  book=toggleFavorite(book,'milky-way');
  assert.deepEqual(book.favorites,['blue-cluster']);
});

test('存储损坏和存储禁止给出可见问题，不伪装成成功保存', () => {
  const broken=readNotebook({getItem:()=>'{not json'},'test');
  assert.equal(broken.notebook.notes.length,0);
  assert.ok(broken.issue);
  assert.throws(()=>writeNotebook({setItem:()=>{throw new Error('storage denied');}},'test',emptyNotebook()),/storage denied/);
  assert.notEqual(notebookKey('旅人'),notebookKey('小宇'));
});

test('保存第81条后仍可读取前80条，不静默删除旧日志', () => {
  const notes=Array.from({length:80},(_,index)=>({id:`original-${index}`,text:`原有观测 ${index+1}`,targetId:'milky-way',createdAt:'2026-09-20T12:00:00Z'}));
  const next=addNote({...emptyNotebook(),notes},'第81条观测','blue-cluster','2026-09-22T12:00:00Z');
  let stored='';
  const storage={getItem:()=>stored,setItem:(_key,value)=>{stored=value;}};
  writeNotebook(storage,'test',next);
  const loaded=readNotebook(storage,'test').notebook;
  assert.equal(next.notes.length,81);
  assert.equal(loaded.notes.length,81);
  assert.equal(loaded.notes[0].text,'第81条观测');
  assert.deepEqual(loaded.notes.slice(1),notes);
});
