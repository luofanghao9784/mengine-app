package com.dreamcore.workspace.collection;
import java.time.*;
import com.dreamcore.workspace.plans.PlanSchedule;
import com.dreamcore.workspace.identity.IdentityException;
public final class CollectionSchedule {
    private CollectionSchedule(){}
    public static Instant next(Instant after,String frequency,String time,String zone) {
        try {
            ZoneId timezone=ZoneId.of(zone);
            return switch(frequency) {
                case "QUARTER_HOUR" -> {if(time!=null)throw IdentityException.invalid();yield after.plusSeconds(900);}
                case "HOURLY" -> {if(time!=null)throw IdentityException.invalid();yield after.plusSeconds(3600);}
                case "DAILY" -> {if(time==null||!time.matches("[0-2][0-9]:[0-5][0-9]"))throw IdentityException.invalid();yield PlanSchedule.next(after,LocalTime.parse(time),timezone);}
                default -> throw IdentityException.invalid();
            };
        } catch(DateTimeException|NullPointerException e){throw IdentityException.invalid();}
    }
}
