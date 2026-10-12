#!/usr/bin/env python3
"""Actual disposable PostgreSQL/MySQL TLS checks. Never contacts configured application DBs."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
import psycopg
from psycopg import sql
import pymysql

spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[2] / 'scripts/data-foundation/collector.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def check(kind, number, root, password):
    config = dict(kind=kind, host='127.0.0.1', port=number, database='postgres' if kind=='postgres' else 'synthetic',
                  username='input_reader', passwordEnv='INPUT_TEST_PASSWORD', caFile=str(root/'cert.pem'),
                  tenantId=str(uuid.uuid4()), connectionId=str(uuid.uuid4()), datasets=[dict(id=str(uuid.uuid4()), key='sales',
                  table='authorized_sales', columns=[dict(source='id',name='编号'),dict(source='amount',name='金额'),dict(source='note',name='备注')])])
    os.environ['INPUT_TEST_PASSWORD']=password
    d=config['datasets'][0]
    request=dict(contractVersion='1.0',tenantId=config['tenantId'],connectionId=config['connectionId'],runId=str(uuid.uuid4()),
                 datasets=[dict(id=d['id'],key=d['key'],columns=[c['name'] for c in d['columns']])])
    result=collector.collect(request,config)
    assert result['snapshots'][0]['rows']==[['0001','9007199254740993.01',None]],result
    assert result['snapshots'][0]['coverageThrough'] is None
    with collector.connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_setting('transaction_read_only')" if kind == 'postgres' else 'SELECT @@transaction_read_only')
            assert cur.fetchone()[0] in ('on', 1), 'transaction is not read-only'
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM sales')
        except Exception:
            pass
        else:
            raise AssertionError('reader wrote source')
    broken={**config,'host':'localhost.invalid'}
    try:
        collector.collect(request,broken)
    except Exception:
        pass
    else:
        raise AssertionError('invalid target accepted')
    print(kind+': TLS verified, approved view only, precision/NULL preserved, source write denied, connection failure rejected',flush=True)


with tempfile.TemporaryDirectory(prefix='input-db-') as directory:
    root=Path(directory)
    password=secrets.token_urlsafe(24)
    secret=root/'password';secret.write_text(password);secret.chmod(0o600)
    with (root/'setup.log').open('w') as log:
        def run(args):
            subprocess.run(args,check=True,stdout=log,stderr=log)
        run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(root/'key.pem'),'-out',str(root/'cert.pem'),
             '-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'])
        (root/'key.pem').chmod(0o600)
        pg=root/'pg';pgport=port()
        run(['initdb','-D',str(pg),'-U','test_admin','--pwfile',str(secret),'--auth=scram-sha-256','--encoding=UTF8','--locale=C'])
        with (pg/'postgresql.conf').open('a') as config:
            config.write(f"\nssl=on\nssl_cert_file='{root}/cert.pem'\nssl_key_file='{root}/key.pem'\n")
        run(['pg_ctl','-D',str(pg),'-l',str(root/'pg.log'),'-o',f'-h 127.0.0.1 -p {pgport} -k {root}','-w','start'])
        try:
            with psycopg.connect(host='127.0.0.1',port=pgport,user='test_admin',password=password,dbname='postgres',autocommit=True) as conn:
                conn.execute('CREATE TABLE sales(id text,amount numeric(25,2),note text,secret text)')
                conn.execute("INSERT INTO sales VALUES('0001',9007199254740993.01,NULL,'excluded')")
                conn.execute('CREATE VIEW authorized_sales AS SELECT id,amount,note FROM sales')
                conn.execute(sql.SQL('CREATE ROLE input_reader LOGIN PASSWORD {}').format(sql.Literal(password)))
                conn.execute('GRANT SELECT ON authorized_sales TO input_reader')
            check('postgres',pgport,root,password)
        finally:
            run(['pg_ctl','-D',str(pg),'-m','immediate','-w','stop'])
        my=root/'mysql';myport=port();sock=str(root/'mysql.sock')
        run(['mysqld','--no-defaults','--initialize-insecure',f'--datadir={my}'])
        proc=subprocess.Popen(['mysqld','--no-defaults',f'--datadir={my}',f'--port={myport}',f'--socket={sock}',
                               '--mysqlx=OFF','--bind-address=127.0.0.1',f'--pid-file={root}/mysql.pid',
                               f'--ssl-ca={root}/cert.pem',f'--ssl-cert={root}/cert.pem',f'--ssl-key={root}/key.pem'],stdout=log,stderr=log)
        try:
            deadline=time.monotonic()+40
            while True:
                try:
                    conn=pymysql.connect(unix_socket=sock,user='root',autocommit=True)
                    break
                except Exception:
                    if proc.poll() is not None or time.monotonic()>deadline:
                        raise RuntimeError('temporary MySQL failed to start')
                    time.sleep(.1)
            try:
                with conn.cursor() as cur:
                    cur.execute('CREATE DATABASE synthetic')
                    cur.execute('CREATE TABLE synthetic.sales(id varchar(40),amount decimal(25,2),note text,secret text)')
                    cur.execute("INSERT INTO synthetic.sales VALUES('0001',9007199254740993.01,NULL,'excluded')")
                    cur.execute('CREATE VIEW synthetic.authorized_sales AS SELECT id,amount,note FROM synthetic.sales')
                    cur.execute("CREATE USER 'input_reader'@'127.0.0.1' IDENTIFIED BY %s REQUIRE SSL",(password,))
                    cur.execute("GRANT SELECT ON synthetic.authorized_sales TO 'input_reader'@'127.0.0.1'")
                check('mysql',myport,root,password)
            finally:
                conn.close()
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                proc.kill();proc.wait()
