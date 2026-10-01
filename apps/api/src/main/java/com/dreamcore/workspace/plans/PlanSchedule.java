package com.dreamcore.workspace.plans;
import java.time.*;
import java.time.temporal.ChronoUnit;
/** One check per local date. DST gaps use the first valid time; overlaps use the earlier offset. */
public final class PlanSchedule {
 private PlanSchedule(){}
 public static Instant occurrence(LocalDate date,LocalTime time,ZoneId zone){
  LocalDateTime local=date.atTime(time);var offsets=zone.getRules().getValidOffsets(local);
  return offsets.isEmpty()?zone.getRules().getTransition(local).getDateTimeAfter().atZone(zone).toInstant():local.atOffset(offsets.getFirst()).toInstant();
 }
 public static Instant next(Instant after,LocalTime time,ZoneId zone){
  LocalDate date=after.atZone(zone).toLocalDate();Instant today=occurrence(date,time,zone);
  return today.isAfter(after)?today:occurrence(date.plusDays(1),time,zone);
 }
 public record Due(Instant latest,int missedSlots){}
 public static Due due(Instant expected,Instant now,LocalTime time,ZoneId zone){
  LocalDate date=now.atZone(zone).toLocalDate();Instant latest=occurrence(date,time,zone);
  if(latest.isAfter(now))latest=occurrence(date.minusDays(1),time,zone);
  return new Due(latest,(int)Math.max(0,ChronoUnit.DAYS.between(expected.atZone(zone).toLocalDate(),latest.atZone(zone).toLocalDate())));
 }
}
