import type { Express, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute:vi.fn(), sendMail:vi.fn(), close:vi.fn(), createTransport:vi.fn() }));
vi.mock('./auth', () => ({ pool:{execute:mocks.execute} }));
vi.mock('./examDelivery', () => ({
  sessionFor: async (req:Request,res:Response) => (req as Request & {user?:{id:string;email:string}}).user ? {user:(req as Request & {user:{id:string;email:string}}).user} : (res.status(401).json({error:'authentication_required'}),null),
  sanitizePayload: (body:Record<string,unknown>) => Array.isArray(body.questions) ? {examTitle:body.examTitle,questions:body.questions,answers:body.answers,language:'ar',uiLanguage:'ar'} : null,
  createReportPdf: async () => Buffer.from('final-pdf'),
  validEmail: (email:string) => email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email),
  limited: () => false,
}));
vi.mock('nodemailer', () => ({default:{createTransport:mocks.createTransport}}));

const owner = {id:'owner',email:'student@example.com'}, outsider = {id:'outsider',email:'other@example.com'};
const recipient = (email:string) => ({name:'Professor',email,course:'Calculus',organization:''});
const uuid = '11111111-1111-4111-8111-111111111111';
type Handler = (req:Request,res:Response)=>Promise<unknown>;
const routes = new Map<string,Handler>();
const app = {post:(path:string,handler:Handler)=>{routes.set(`POST ${path}`,handler);},get:(path:string,handler:Handler)=>{routes.set(`GET ${path}`,handler);},delete:(path:string,handler:Handler)=>{routes.set(`DELETE ${path}`,handler);}} as unknown as Express;
const req = (body:Record<string,unknown>, user = owner, key = 'request-key-123') => ({ body, user, params:{id:uuid}, ip:'127.0.0.1', is:()=>true, header:(name:string)=>name==='Idempotency-Key'?key:undefined, headers:{} }) as unknown as Request;
const res = () => { const response={ statusCode:200, body:null as any, status:vi.fn((code:number)=>{response.statusCode=code;return response;}), json:vi.fn((body:any)=>{response.body=body;return response;}), set:vi.fn(()=>response), type:vi.fn(()=>response), send:vi.fn(()=>response), end:vi.fn(()=>response) }; return response as unknown as Response & {statusCode:number;body:any}; };

describe('approved exam delivery', () => {
  let submission:any, operation:any, targets:any[], failTargetInsert:boolean;
  beforeEach(async () => {
    vi.resetModules(); routes.clear(); submission=null; operation=null; targets=[]; failTargetInsert=false;
    vi.stubEnv('SUPPORT_SMTP_HOST','smtp.test'); vi.stubEnv('SUPPORT_SMTP_USER','user'); vi.stubEnv('SUPPORT_SMTP_PASSWORD','secret'); vi.stubEnv('SUPPORT_EMAIL_FROM','sender@example.com');
    mocks.sendMail.mockReset().mockImplementation(async (message:{to:string})=>({accepted:[message.to]}));
    mocks.close.mockReset(); mocks.createTransport.mockReset().mockImplementation(()=>({sendMail:mocks.sendMail,close:mocks.close}));
    mocks.execute.mockReset().mockImplementation(async (sql:string,args:any[]=[]) => {
      if (sql.startsWith('INSERT INTO basira_exam_submissions')) { submission={id:args[0],user_id:args[1],course_name:args[2],exam_title:args[3],pdf_data:args[4],status:args[5]}; return [{affectedRows:1}]; }
      if (sql.startsWith('SELECT id,user_id,course_name')) return [[submission && submission.id===args[0] && submission.user_id===args[1] ? submission : undefined].filter(Boolean)];
      if (sql.startsWith('SELECT s.id,s.course_name')) return [[submission && submission.user_id===args[0] ? {id:submission.id,course_name:submission.course_name,exam_title:submission.exam_title,status:submission.status,approved_at:new Date(),latest_delivery_id:operation?.id ?? null} : undefined].filter(Boolean)];
      if (sql.startsWith('SELECT id,status,submission_id') && sql.includes('request_key')) return [[operation && operation.request_key===args[0] && operation.user_id===args[1] ? operation : undefined].filter(Boolean)];
      if (sql.startsWith('SELECT id,status,submission_id') && sql.includes('WHERE submission_id=')) return [[operation && operation.submission_id===args[0] && operation.user_id===args[1] && operation.status==='SENDING' ? operation : undefined].filter(Boolean)];
      if (sql.startsWith('SELECT id,status,submission_id') && sql.includes('WHERE id=')) return [[operation && operation.id===args[0] && operation.user_id===args[1] ? operation : undefined].filter(Boolean)];
      if (sql.startsWith("UPDATE basira_exam_delivery_operations SET status='FAILED' WHERE id=? AND user_id=?")) { if (operation?.id===args[0] && operation.user_id===args[1] && operation.status==='SENDING' && operation.stale) { operation.status='FAILED'; return [{affectedRows:1}]; } return [{affectedRows:0}]; }
      if (sql.startsWith("UPDATE basira_exam_delivery_operations SET status='FAILED' WHERE id=?")) { if (operation?.id===args[0] && operation.status==='SENDING') operation.status='FAILED'; return [{affectedRows:1}]; }
      if (sql.startsWith("UPDATE basira_exam_delivery_targets SET delivery_status='UNCERTAIN'")) { targets.filter(value=>value.operation_id===args[0]&&value.delivery_status==='SENDING').forEach(value=>Object.assign(value,{delivery_status:'UNCERTAIN',failure_reason_code:'delivery_interrupted'})); return [{affectedRows:1}]; }
      if (sql.startsWith("UPDATE basira_exam_submissions SET status='FAILED'")) { if (sql.includes('sending_started_at <') && !submission?.stale) return [{affectedRows:0}]; if (submission?.status==='SENDING') submission.status='FAILED'; return [{affectedRows:1}]; }
      if (sql.startsWith('UPDATE basira_exam_submissions SET status=\'SENDING\'')) { if (!submission || submission.user_id!==args[1] || submission.status==='SENDING') return [{affectedRows:0}]; submission.status='SENDING'; return [{affectedRows:1}]; }
      if (sql.startsWith('UPDATE basira_exam_submissions SET status=?')) { submission.status=args[0]; return [{affectedRows:1}]; }
      if (sql.startsWith('INSERT INTO basira_exam_delivery_operations')) { operation={id:args[0],submission_id:args[1],user_id:args[2],request_key:args[3],status:args[4]}; return [{affectedRows:1}]; }
      if (sql.startsWith('UPDATE basira_exam_delivery_operations')) { operation.status=args[0]; return [{affectedRows:1}]; }
      if (sql.startsWith('INSERT INTO basira_exam_delivery_targets')) { if (failTargetInsert) throw new Error('database unavailable'); targets.push({operation_id:args[1],recipient_name:args[2],recipient_email:args[3],course_name:args[4],organization:args[5],delivery_status:args[6],sent_at:null,failure_reason_code:null}); return [{affectedRows:1}]; }
      if (sql.startsWith('UPDATE basira_exam_delivery_targets')) { const target=targets.find(value=>value.operation_id===args[3]&&value.recipient_email===args[4]); Object.assign(target,{delivery_status:args[0],sent_at:args[1],failure_reason_code:args[2]}); return [{affectedRows:1}]; }
      if (sql.startsWith('SELECT delivery_status FROM basira_exam_delivery_targets')) return [targets.filter(value=>value.operation_id===args[0]).map(value=>({delivery_status:value.delivery_status}))];
      if (sql.startsWith('SELECT recipient_name,recipient_email')) return [targets.filter(value=>value.operation_id===args[0])];
      if (sql.startsWith('SELECT t.id AS teacher_id')) return [[{teacher_id:uuid,name:'Professor',email:'one@example.com',institution:null,course_name:'Calculus'}]];
      throw new Error(`Unmocked SQL: ${sql}`);
    });
    const {registerExamSubmissionRoutes}=await import('./examSubmissions'); registerExamSubmissionRoutes(app);
  });
  const prepare = async () => { const response=res(); await routes.get('POST /api/exam-delivery/submissions')!(req({approved:true,course:'Calculus',examTitle:'Private exam',questions:[{id:1,text:'Question'}],answers:{1:'Answer'}}),response); return response; };
  it('requires explicit final approval and stores an owner-bound PDF', async () => {
    const rejected=res(); await routes.get('POST /api/exam-delivery/submissions')!(req({course:'Calculus',questions:[{id:1}]}),rejected); expect(rejected.statusCode).toBe(400);
    const accepted=await prepare(); expect(accepted.statusCode).toBe(201); expect(submission.user_id).toBe(owner.id); expect(submission.pdf_data.toString()).toBe('final-pdf'); expect(submission.status).toBe('READY_TO_SEND');
  });
  it('lists only the owner\'s saved final exams without exposing PDF data', async () => {
    await prepare();
    const mine=res(); await routes.get('GET /api/exam-delivery/submissions')!(req({}),mine);
    expect(mine.body.submissions).toHaveLength(1); expect(mine.body.submissions[0].course).toBe('Calculus'); expect(JSON.stringify(mine.body)).not.toContain('final-pdf');
    const theirs=res(); await routes.get('GET /api/exam-delivery/submissions')!(req({},outsider),theirs); expect(theirs.body.submissions).toHaveLength(0);
  });
  it('validates every recipient, sends separately, and returns one immutable idempotent operation', async () => {
    const accepted=await prepare(); const body={submissionId:accepted.body.submissionId,confirmed:true,recipients:[recipient('one@example.com'),recipient('two@example.com')]};
    const invalid=res(); await routes.get('POST /api/exam-delivery/operations')!(req({...body,recipients:[recipient('invalid')]}),invalid); expect(invalid.statusCode).toBe(400);
    const sent=res(); await routes.get('POST /api/exam-delivery/operations')!(req(body),sent); expect(sent.statusCode).toBe(201); expect(sent.body.status).toBe('SENT'); expect(sent.body.recipients).toHaveLength(2); expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(mocks.sendMail.mock.calls[0][0].subject).toContain('Calculus'); expect(mocks.sendMail.mock.calls[0][0].subject).not.toContain('Private exam');
    expect(mocks.sendMail.mock.calls[0][0].text).toContain('اسم الطالب: student@example.com');
    const duplicate=res(); await routes.get('POST /api/exam-delivery/operations')!(req(body),duplicate); expect(duplicate.body.duplicate).toBe(true); expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });
  it('requires a selected teacher to match the owned course and reviewed email',async()=>{
    const accepted=await prepare();
    const wrong=res();await routes.get('POST /api/exam-delivery/operations')!(req({submissionId:accepted.body.submissionId,confirmed:true,courseId:uuid,recipients:[{...recipient('wrong@example.com'),teacherId:uuid}]}),wrong);
    expect(wrong.statusCode).toBe(409);expect(mocks.sendMail).not.toHaveBeenCalled();
    const correct=res();await routes.get('POST /api/exam-delivery/operations')!(req({submissionId:accepted.body.submissionId,confirmed:true,courseId:uuid,recipients:[{...recipient('one@example.com'),teacherId:uuid}]}),correct);
    expect(correct.statusCode).toBe(201);expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });
  it('prevents another user from reading or sending the final exam', async () => {
    const accepted=await prepare(); const get=res(); await routes.get('GET /api/exam-delivery/submissions/:id')!(req({},outsider),get); expect(get.statusCode).toBe(404);
    const send=res(); await routes.get('POST /api/exam-delivery/operations')!(req({submissionId:accepted.body.submissionId,confirmed:true,recipients:[recipient('one@example.com')]},outsider),send); expect(send.statusCode).toBe(404); expect(mocks.sendMail).not.toHaveBeenCalled();
  });
  it('keeps the final PDF and sanitized failure state when SMTP rejects delivery', async () => {
    const accepted=await prepare(); mocks.sendMail.mockRejectedValue({responseCode:550,response:'private SMTP diagnostics'});
    const failed=res(); await routes.get('POST /api/exam-delivery/operations')!(req({submissionId:accepted.body.submissionId,confirmed:true,recipients:[recipient('one@example.com')]}),failed);
    expect(failed.statusCode).toBe(503); expect(failed.body.status).toBe('FAILED'); expect(failed.body.recipients[0].failureReasonCode).toBe('smtp_rejected'); expect(JSON.stringify(failed.body)).not.toContain('private SMTP diagnostics'); expect(submission.pdf_data.toString()).toBe('final-pdf');
  });
  it('requires authentication and caps the recipient list', async () => {
    const anonymous=res(); await routes.get('POST /api/exam-delivery/submissions')!(req({approved:true,course:'Calculus',questions:[{id:1}]},null as any),anonymous); expect(anonymous.statusCode).toBe(401);
    const accepted=await prepare(); const tooMany=res(); await routes.get('POST /api/exam-delivery/operations')!(req({submissionId:accepted.body.submissionId,confirmed:true,recipients:Array.from({length:6},(_,i)=>recipient(`p${i}@example.com`))}),tooMany); expect(tooMany.statusCode).toBe(400); expect(mocks.sendMail).not.toHaveBeenCalled();
  });
  it('allows a deliberate new operation after failure, preserving the original record', async () => {
    const accepted=await prepare(); const body={submissionId:accepted.body.submissionId,confirmed:true,recipients:[recipient('one@example.com')]};
    mocks.sendMail.mockRejectedValueOnce({responseCode:550});
    const first=res(); await routes.get('POST /api/exam-delivery/operations')!(req(body),first); expect(first.body.status).toBe('FAILED'); const firstId=first.body.deliveryId;
    const second=res(); await routes.get('POST /api/exam-delivery/operations')!(req({...body,resend:true},owner,'new-request-key-123'),second); expect(second.body.status).toBe('SENT'); expect(second.body.deliveryId).not.toBe(firstId); expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });
  it('recovers the submission state if target creation fails before SMTP', async () => {
    const accepted=await prepare(); failTargetInsert=true;
    const failed=res(); await routes.get('POST /api/exam-delivery/operations')!(req({submissionId:accepted.body.submissionId,confirmed:true,recipients:[recipient('one@example.com')]}),failed);
    expect(failed.statusCode).toBe(503); expect(submission.status).toBe('FAILED'); expect(operation.status).toBe('FAILED'); expect(mocks.sendMail).not.toHaveBeenCalled();
  });
  it('marks an interrupted SMTP operation uncertain before explicit retry', async () => {
    const accepted=await prepare(); submission.status='SENDING';
    operation={id:uuid,submission_id:accepted.body.submissionId,user_id:owner.id,request_key:'old',status:'SENDING',stale:true};
    targets=[{operation_id:uuid,recipient_name:'Professor',recipient_email:'one@example.com',course_name:'Calculus',organization:null,delivery_status:'SENDING',sent_at:null,failure_reason_code:null}];
    const result=res(); await routes.get('GET /api/exam-delivery/operations/:id')!(req({}),result);
    expect(result.body.status).toBe('FAILED'); expect(result.body.recipients[0].deliveryStatus).toBe('UNCERTAIN'); expect(submission.status).toBe('FAILED'); expect(mocks.sendMail).not.toHaveBeenCalled();
  });
  it('recovers a stale claim left before an operation record was created', async () => {
    const accepted=await prepare(); submission.status='SENDING'; submission.stale=true;
    const attempt=res(); await routes.get('POST /api/exam-delivery/operations')!(req({submissionId:accepted.body.submissionId,confirmed:true,recipients:[recipient('one@example.com')]},owner,'new-request-key-123'),attempt);
    expect(attempt.statusCode).toBe(201); expect(attempt.body.status).toBe('SENT'); expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });
});
