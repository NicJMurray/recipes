import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function createDatabase(filename=':memory:'){
  const sqlite=new DatabaseSync(filename);
  sqlite.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
  const convert=x=>x instanceof ArrayBuffer?new Uint8Array(x):x;
  class Statement{
    constructor(sql,values=[]){this.sql=sql;this.values=values;}
    bind(...values){return new Statement(this.sql,values);}
    async first(column){const row=sqlite.prepare(this.sql).get(...this.values.map(convert));return row?(column?row[column]:row):null;}
    async all(){return {success:true,results:sqlite.prepare(this.sql).all(...this.values.map(convert))};}
    async run(){const s=sqlite.prepare(this.sql),values=this.values.map(convert);if(/\bRETURNING\b/i.test(this.sql))return {success:true,results:s.all(...values)};const result=s.run(...values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
  }
  return {sqlite,prepare:sql=>new Statement(sql),async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},close:()=>sqlite.close()};
}
