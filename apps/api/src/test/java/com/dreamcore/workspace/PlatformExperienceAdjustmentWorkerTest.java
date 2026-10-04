package com.dreamcore.workspace;

import com.dreamcore.workspace.experience.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PlatformExperienceAdjustmentWorkerTest {
 PlatformExperienceAdjustmentService queue=mock(PlatformExperienceAdjustmentService.class);
 ExperienceAnalysisRuntime analysis=mock(ExperienceAnalysisRuntime.class);
 ExperienceGeneralizationRuntime general=mock(ExperienceGeneralizationRuntime.class);
 PlatformExperienceAdjustmentService.Work work(){UUID id=UUID.randomUUID(),lease=UUID.randomUUID();return new PlatformExperienceAdjustmentService.Work(id,lease,"EXTRACT",ExperienceAnalysisRuntime.Job.platform(id,lease,UUID.randomUUID(),List.of(),List.of(),List.of()),null);}
 @Test void unknownDispatchRecoversOriginalReceiptWithoutAnotherModelRequest(){
  var w=work();var descriptor=new ExperienceAnalysisRuntime.Descriptor("1.0","synthetic",true,"live");when(analysis.preflight()).thenReturn(descriptor);
  when(analysis.execute(eq(w.analysis()),eq(descriptor),any())).thenThrow(new ExperienceAnalysisRuntime.Failure("EXPERIENCE_RESULT_UNKNOWN",true));when(queue.restore(w.id())).thenReturn(w);
  var worker=new PlatformExperienceAdjustmentWorker(queue,analysis,general,true);
  try{
   worker.execute(w);verify(queue).uncertain(w.id());
   var recovery=new PlatformExperienceAdjustmentService.Recovery(w.id(),w.lease(),"EXTRACT","DISPATCHED","synthetic",false,false);
   worker.recover(recovery);worker.recover(recovery);
   verify(analysis,times(1)).execute(any(),any(),any());verify(analysis,times(2)).recover(w.analysis(),"synthetic");verify(queue,never()).fail(any(),anyString(),anyBoolean());
  }finally{worker.stop();}
 }
 @Test void expiredResultCannotBePublishedAndFinalUnknownIsCancelledAndClosed(){
  var w=work();when(queue.restore(w.id())).thenReturn(w);
  when(analysis.recover(w.analysis(),"synthetic")).thenReturn(new ExperienceAnalysisRuntime.Result("1.0","synthetic","live",w.id(),w.lease(),w.analysis().source(),false,"SKIPPED","DUPLICATE",null,null,List.of(),"PLATFORM"));
  var worker=new PlatformExperienceAdjustmentWorker(queue,analysis,general,true);
  try{
   worker.recover(new PlatformExperienceAdjustmentService.Recovery(w.id(),w.lease(),"EXTRACT","DISPATCHED","synthetic",true,false));
   verify(queue,never()).complete(any(ExperienceAnalysisRuntime.Result.class));verify(analysis).cancel(w.id(),w.lease());
   worker.recover(new PlatformExperienceAdjustmentService.Recovery(w.id(),w.lease(),"EXTRACT","DISPATCHED","synthetic",true,true));
   verify(queue).fail(w.id(),"GENERAL_ADJUSTMENT_RESULT_UNKNOWN",true);verify(analysis,times(1)).recover(any(),anyString());verify(analysis,never()).execute(any(),any(),any());
  }finally{worker.stop();}
 }
 @Test void unavailableFixedSourceCancelsWithoutAskingForAnotherResultOrReplaying(){
  var w=work();when(queue.restore(w.id())).thenThrow(new com.dreamcore.workspace.identity.IdentityException(409,"GENERAL_ADJUSTMENT_SOURCE_CHANGED"));
  var worker=new PlatformExperienceAdjustmentWorker(queue,analysis,general,true);
  try{worker.recover(new PlatformExperienceAdjustmentService.Recovery(w.id(),w.lease(),"EXTRACT","DISPATCHED","synthetic",false,false));verify(analysis).cancel(w.id(),w.lease());verify(queue).fail(w.id(),"GENERAL_ADJUSTMENT_SOURCE_CHANGED",true);verify(analysis,never()).recover(any(),anyString());verify(analysis,never()).execute(any(),any(),any());}finally{worker.stop();}
 }
}
