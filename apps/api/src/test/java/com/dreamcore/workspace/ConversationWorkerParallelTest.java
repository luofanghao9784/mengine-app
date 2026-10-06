package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.*;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class ConversationWorkerParallelTest {
 @Test void fiveJobsActuallyOverlapAndOneFailureDoesNotBlockOtherJobs() throws Exception {
  var service=mock(ConversationService.class);var agents=mock(AgentTaskService.class);
  var entered=new CountDownLatch(5);var release=new CountDownLatch(1);var finished=new CountDownLatch(5);
  var jobs=new ArrayList<ConversationService.Job>();UUID actor=UUID.randomUUID(),tenant=UUID.randomUUID();
  for(int i=0;i<5;i++)jobs.add(new ConversationService.Job(UUID.randomUUID(),tenant,UUID.randomUUID(),UUID.randomUUID(),actor,"synthetic",UUID.randomUUID(),"SOURCE_LOOKUP"));
  var queue=new java.util.concurrent.ConcurrentLinkedQueue<>(jobs);when(service.claim()).thenAnswer(i->queue.poll());
  when(service.sources(any())).thenReturn(List.of());
  TaskRuntime runtime=(task,attempt,sources)->{entered.countDown();try{assertTrue(release.await(5,TimeUnit.SECONDS));}catch(InterruptedException e){throw new RuntimeException(e);}if(task.equals(jobs.getFirst().id()))throw new RuntimeException("synthetic failure");return new TaskRuntime.Result("1.0","synthetic",task,attempt,"SOURCE_LOOKUP","synthetic",List.of());};
  doAnswer(i->{finished.countDown();return null;}).when(service).finish(any(),any());
  doAnswer(i->{finished.countDown();return null;}).when(service).fail(any(),any());
  var worker=new ConversationWorker(service,runtime,agents);
  try{worker.tick();assertTrue(entered.await(3,TimeUnit.SECONDS),"Five runtime calls must overlap before any returns");release.countDown();assertTrue(finished.await(3,TimeUnit.SECONDS));verify(service,times(4)).finish(any(),any());verify(service,times(1)).fail(any(),eq("TASK_RUNTIME_UNAVAILABLE"));}finally{release.countDown();worker.stop();}
 }

 @Test void shutdownDoesNotForgeAFailedResultForInterruptedExecution() throws Exception {
  var service=mock(ConversationService.class);var agents=mock(AgentTaskService.class);var entered=new CountDownLatch(1);var interrupted=new CountDownLatch(1);
  var job=new ConversationService.Job(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"synthetic",UUID.randomUUID(),"SOURCE_LOOKUP");
  when(service.claim()).thenReturn(job,null);when(service.sources(job)).thenReturn(List.of());
  TaskRuntime runtime=(task,attempt,sources)->{entered.countDown();try{new CountDownLatch(1).await();}catch(InterruptedException e){interrupted.countDown();throw new RuntimeException(e);}throw new AssertionError();};
  var worker=new ConversationWorker(service,runtime,agents);worker.tick();assertTrue(entered.await(3,TimeUnit.SECONDS));worker.stop();assertTrue(interrupted.await(3,TimeUnit.SECONDS));
  // Join tasks, so the assertions cannot pass before the catch path runs.
  var f=ConversationWorker.class.getDeclaredField("executor");f.setAccessible(true);assertTrue(((ExecutorService)f.get(worker)).awaitTermination(3,TimeUnit.SECONDS));
  verify(service,never()).fail(any(),any());verify(service,never()).finish(any(),any());
 }
}
