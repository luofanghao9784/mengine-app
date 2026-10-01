package com.dreamcore.workspace;
import com.dreamcore.workspace.plans.PlanSchedule;
import java.time.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class PlanScheduleTest {
 @Test void daylightGapUsesFirstValidTime(){assertEquals(Instant.parse("2026-03-08T07:00:00Z"),PlanSchedule.occurrence(LocalDate.parse("2026-03-08"),LocalTime.parse("02:30"),ZoneId.of("America/New_York")));}
 @Test void repeatedHourHasOnlyOneEarlierOccurrence(){var zone=ZoneId.of("America/New_York");var time=LocalTime.parse("01:30");assertEquals(Instant.parse("2026-11-01T05:30:00Z"),PlanSchedule.occurrence(LocalDate.parse("2026-11-01"),time,zone));assertEquals(Instant.parse("2026-11-02T06:30:00Z"),PlanSchedule.next(Instant.parse("2026-11-01T05:30:00Z"),time,zone));}
 @Test void downtimeRecordsSkippedDatesInsteadOfInventingExecutedChecks(){var due=PlanSchedule.due(Instant.parse("2026-10-01T01:00:00Z"),Instant.parse("2026-10-04T02:00:00Z"),LocalTime.parse("09:00"),ZoneId.of("Asia/Shanghai"));assertEquals(3,due.missedSlots());assertEquals(Instant.parse("2026-10-04T01:00:00Z"),due.latest());}
}
