import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import {
  Action,
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';
import RetrospectivePanel from '../ai/RetrospectivePanel';
import SocialSettingsScreen from './SocialSettingsScreen';
import SocialReviewableOwnersScreen from './SocialReviewableOwnersScreen';
import SocialReceivedReviewsScreen from './SocialReceivedReviewsScreen';
import SocialRankingsScreen from './SocialRankingsScreen';
import SocialPeopleScreen from './SocialPeopleScreen';

const tabs = ['互评账单', '我的反馈', '排行榜', '关系管理'] as const;
export default function SocialCommunityScreen({
  navigation,
}: {
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    [tab, setTab] = useState(0);
  const [showRetrospective, setShowRetrospective] = useState(false);
  const r = useSocialResource(useCallback(() => api.status(), [api]));
  if (!r.value)
    return (
      <Page>
        <Status {...r} />
      </Page>
    );
  if (!r.value.enabled)
    return (
      <SocialSettingsScreen navigation={navigation} onEnabled={r.refresh} />
    );
  return (
    <View style={s.screen}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
        <View style={s.row}>
          <Text style={[s.heading, s.grow]}>社群</Text>
          <Action
            title="消息"
            onPress={() => navigation.navigate('SocialInbox')}
          />
          <Action
            title="隐私"
            onPress={() => navigation.navigate('SocialSettings')}
          />
        </View>
        <View accessibilityRole="tablist" style={[s.row, { gap: 8 }]}>
          {tabs.map((label, index) => (
            <TouchableOpacity
              key={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === index }}
              onPress={() => setTab(index)}
              style={[
                s.button,
                s.grow,
                { paddingHorizontal: 4 },
                tab === index && s.primary,
              ]}
            >
              <Text
                style={[
                  s.buttonText,
                  { fontSize: 13 },
                  tab === index && s.primaryText,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={{ paddingHorizontal: 16 }}><Action title="AI 消费复盘" onPress={() => setShowRetrospective(true)} /></View>
      {showRetrospective && <RetrospectivePanel navigation={navigation} onClose={() => setShowRetrospective(false)} />}
      {tab === 0 && <SocialReviewableOwnersScreen navigation={navigation} />}
      {tab === 1 && <SocialReceivedReviewsScreen navigation={navigation} />}
      {tab === 2 && <SocialRankingsScreen navigation={navigation} />}
      {tab === 3 && (
        <SocialPeopleScreen
          navigation={navigation}
          route={{ params: { mode: 'following' } }}
          community
        />
      )}
    </View>
  );
}
